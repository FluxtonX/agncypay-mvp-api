import { Injectable, Logger, Inject } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../modules/audit-logs/audit-logs.service';
import { LedgerService } from '../modules/ledger/ledger.service';
import { PaymentStateService } from '../modules/payments/payment-state.service';
import { PayoutStateService } from '../modules/payouts/payout-state.service';
import { CybridAccountService } from '../modules/cybrid/cybrid-account.service';
import type { IFinancialProvider } from '../core/interfaces/financial-provider.interface';
import { KybStatus } from '@prisma/client';

@Injectable()
export class CybridWebhookService {
  private readonly logger = new Logger(CybridWebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
    private readonly ledgerService: LedgerService,
    private readonly paymentStateService: PaymentStateService,
    private readonly payoutStateService: PayoutStateService,
    private readonly accountService: CybridAccountService,
    @Inject('IFinancialProvider') private readonly cybridProvider: IFinancialProvider,
  ) {}

  async processWebhookEvent(rawPayload: any, signature?: string): Promise<{ success: boolean; eventId: string; status: string }> {
    const payloadStr = typeof rawPayload === 'string' ? rawPayload : JSON.stringify(rawPayload);
    const event = typeof rawPayload === 'string' ? JSON.parse(rawPayload) : rawPayload;

    const eventId = event.guid || event.id || `evt_${Date.now()}`;
    const eventType = event.event_type || event.type || 'unknown';

    this.logger.log(`Received Cybrid webhook event [${eventId}]: ${eventType}`);

    // 1. Signature check (if signature provided or in production)
    if (signature) {
      const isValid = this.cybridProvider.verifyWebhookSignature(payloadStr, signature);
      if (!isValid) {
        const isSandbox = process.env.CYBRID_ENVIRONMENT !== 'production';
        if (isSandbox) {
          this.logger.warn(`Webhook signature mismatch in sandbox mode for event ${eventId} — proceeding with event processing.`);
        } else {
          this.logger.error(`Webhook signature verification failed for event ${eventId}`);
          throw new Error('Invalid webhook signature');
        }
      }
    }

    // 2. Persist & Deduplicate
    const existing = await this.prisma.webhookEvent.findUnique({
      where: { eventId },
    });

    if (existing && existing.status === 'processed') {
      this.logger.log(`Duplicate webhook event ${eventId} already processed — skipping.`);
      return { success: true, eventId, status: 'already_processed' };
    }

    const savedEvent = await this.prisma.webhookEvent.upsert({
      where: { eventId },
      update: { status: 'processing', payload: event },
      create: { eventId, eventType, status: 'processing', payload: event },
    });

    // 3. Process event based on type
    try {
      if (eventType.startsWith('transfer.') || eventType.startsWith('deposit.')) {
        await this.handleTransferEvent(event);
      } else if (eventType.startsWith('trade.')) {
        await this.handleTradeEvent(event);
      } else if (eventType.startsWith('identity_verification.')) {
        await this.handleIdentityVerificationEvent(event);
      } else if (eventType.startsWith('customer.')) {
        await this.handleCustomerEvent(event);
      } else {
        this.logger.debug(`Unhandled event type ${eventType}`);
      }

      await this.prisma.webhookEvent.update({
        where: { id: savedEvent.id },
        data: { status: 'processed', processedAt: new Date() },
      });

      await this.auditLogsService.log({
        action: 'CYBRID_WEBHOOK_PROCESSED',
        entityType: 'WebhookEvent',
        entityId: savedEvent.id,
        details: { eventId, eventType, status: 'processed' },
      });

      return { success: true, eventId, status: 'processed' };
    } catch (err) {
      this.logger.error(`Error processing webhook event ${eventId}: ${err.message}`);
      await this.prisma.webhookEvent.update({
        where: { id: savedEvent.id },
        data: { status: 'failed' },
      });
      throw err;
    }
  }

  private async handleTransferEvent(event: any) {
    const transferGuid = event.object_guid || event.guid || event.transfer_guid;
    const action = event.action || event.status || (event.event_type ? event.event_type.split('.')[1] : 'completed');
    const depositAccountGuid = event.deposit_account_guid || event.deposit_bank_account_guid || event.destination_account_guid;

    // Check if this transfer belongs to an inbound Payment (prioritize active/pending payment)
    let payment = await this.prisma.payment.findFirst({
      where: {
        OR: [
          ...(transferGuid ? [{ cybridTransferGuid: transferGuid }] : []),
          ...(depositAccountGuid ? [{ cybridDepositRef: depositAccountGuid }] : []),
        ],
        status: { in: ['PENDING_FUNDING', 'FUNDED', 'PROCESSING'] },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!payment) {
      payment = await this.prisma.payment.findFirst({
        where: {
          OR: [
            ...(transferGuid ? [{ cybridTransferGuid: transferGuid }] : []),
            ...(depositAccountGuid ? [{ cybridDepositRef: depositAccountGuid }] : []),
          ],
        },
        orderBy: { createdAt: 'desc' },
      });
    }

    // If not found by direct GUID, check if deposit account matches an Agency deposit bank account with a pending payment
    if (!payment && depositAccountGuid) {
      const depositBank = await this.prisma.cybridDepositBankAccount.findFirst({
        where: {
          OR: [
            { cybridDepositBankGuid: depositAccountGuid },
            { cybridAccountId: depositAccountGuid },
            { uniqueMemoId: depositAccountGuid },
          ],
        },
        include: {
          cybridAccount: {
            include: {
              cybridCustomer: true,
            },
          },
        },
      });

      if (depositBank?.cybridAccount?.cybridCustomer?.userId) {
        const agencyUserId = depositBank.cybridAccount.cybridCustomer.userId;
        payment = await this.prisma.payment.findFirst({
          where: {
            agencyId: agencyUserId,
            status: 'PENDING_FUNDING',
          },
          orderBy: { createdAt: 'desc' },
        });
      }
    }

    if (payment) {
      if (action === 'completed' || action === 'settled') {
        // Transition payment state
        await this.paymentStateService.transition(payment.id, 'COMPLETED', {
          providerRef: transferGuid,
        });

        if (transferGuid && !payment.cybridTransferGuid) {
          await this.prisma.payment.update({
            where: { id: payment.id },
            data: { cybridTransferGuid: transferGuid },
          });
        }

        // Post double-entry journal entry
        // Debit: CLEARING:CYBRID_DEPOSIT:USD
        // Credit: AGENCY:{agencyId}:USD
        await this.ledgerService.postJournalEntry({
          debitAccountCode: `CLEARING:CYBRID_DEPOSIT:USD`,
          creditAccountCode: `AGENCY:${payment.agencyId}:USD`,
          amount: payment.amount,
          currency: payment.currency,
          referenceType: 'BRAND_PAYMENT_FUNDED_WEBHOOK',
          referenceId: payment.id,
          providerReference: transferGuid || payment.cybridDepositRef || undefined,
          description: `Confirmed inbound payment ${payment.paymentNumber} via Cybrid deposit webhook`,
        });

        // Update linked invoice if present
        if (payment.invoiceId) {
          await this.prisma.invoice.update({
            where: { id: payment.invoiceId },
            data: { status: 'paid', payoutStatus: 'disbursed' },
          });
        }

        // Sync legacy Wallet balance if exists
        await this.syncLegacyWalletBalance(payment.agencyId);
      } else if (action === 'failed' || action === 'returned') {
        await this.paymentStateService.transition(payment.id, action === 'failed' ? 'FAILED' : 'RETURNED', {
          reason: event.failure_code || 'Transfer failed or returned by bank',
          stage: 'TRANSFER_SETTLEMENT',
          providerRef: transferGuid,
        });
      }
      return;
    }

    // Check if this transfer belongs to an outbound Payout
    const payout = await this.prisma.paymentPayout.findFirst({
      where: {
        OR: [
          ...(transferGuid ? [{ cybridTransferGuid: transferGuid }] : []),
          ...(event.quote_guid ? [{ cybridQuoteGuid: event.quote_guid }] : []),
        ],
      },
    });

    if (payout) {
      if (action === 'completed' || action === 'settled') {
        await this.payoutStateService.transition(payout.id, 'COMPLETED', {
          providerRef: transferGuid,
        });
      } else if (action === 'failed' || action === 'returned') {
        await this.payoutStateService.transition(payout.id, action === 'failed' ? 'FAILED' : 'RETURNED', {
          reason: event.failure_code || 'Payout transfer failed or returned',
          stage: 'PAYOUT_SETTLEMENT',
          providerRef: transferGuid,
        });

        // Reversal entry to return funds to Agency ledger
        await this.ledgerService.postJournalEntry({
          debitAccountCode: `CLEARING:CYBRID_OUTBOUND:USD`,
          creditAccountCode: `AGENCY:${payout.agencyId}:USD`,
          amount: payout.amount,
          currency: payout.currency,
          referenceType: 'PAYOUT_REVERSAL',
          referenceId: payout.id,
          providerReference: transferGuid,
          description: `Reversal of failed payout ${payout.payoutNumber}`,
        });

        // Sync legacy Wallet balance if exists
        await this.syncLegacyWalletBalance(payout.agencyId);
      }
    }
  }

  private async handleTradeEvent(event: any) {
    const tradeGuid = event.object_guid || event.guid || event.trade_guid;
    const action = event.action || event.status || (event.event_type ? event.event_type.split('.')[1] : 'completed');

    const payout = await this.prisma.paymentPayout.findFirst({
      where: { cybridTradeGuid: tradeGuid },
    });

    if (payout) {
      if (action === 'completed' || action === 'settled') {
        await this.payoutStateService.transition(payout.id, 'TRADE_COMPLETED', {
          providerRef: tradeGuid,
        });
      } else if (action === 'failed') {
        await this.payoutStateService.transition(payout.id, 'FAILED', {
          reason: event.failure_code || 'FX trade failed',
          stage: 'FX_TRADE',
          providerRef: tradeGuid,
        });

        // Reversal entry to return funds to Agency ledger from trading account
        await this.ledgerService.postJournalEntry({
          debitAccountCode: `AGENCY:${payout.agencyId}:USDC_TRADING`,
          creditAccountCode: `AGENCY:${payout.agencyId}:USD`,
          amount: payout.amount,
          currency: payout.currency,
          referenceType: 'TRADE_REVERSAL',
          referenceId: payout.id,
          providerReference: tradeGuid,
          description: `Reversal of failed FX trade for payout ${payout.payoutNumber}`,
        });

        await this.syncLegacyWalletBalance(payout.agencyId);
      }
    }
  }

  private async handleIdentityVerificationEvent(event: any) {
    const verificationGuid = event.object_guid || event.guid;
    const outcome = event.outcome || (event.state === 'completed' ? 'passed' : undefined);

    const customer = await this.prisma.cybridCustomer.findFirst({
      where: { kybVerificationGuid: verificationGuid },
    });

    if (customer) {
      const isPassed = outcome === 'passed';
      const status = isPassed ? 'approved' : 'rejected';

      await this.prisma.cybridCustomer.update({
        where: { id: customer.id },
        data: {
          kybStatus: status,
          kybOutcome: outcome,
        },
      });

      await this.prisma.user.update({
        where: { id: customer.userId },
        data: { kybStatus: isPassed ? KybStatus.approved : KybStatus.rejected },
      });

      if (isPassed) {
        // Automatically provision USD Fiat Account and Deposit Bank Account
        await this.accountService.ensureDepositBankAccount(customer.userId);
      }

      await this.auditLogsService.log({
        userId: customer.userId,
        action: `KYB_VERIFICATION_${status.toUpperCase()}`,
        entityType: 'CybridCustomer',
        entityId: customer.id,
        details: { verificationGuid, outcome, kybStatus: status },
      });
    }
  }

  private async handleCustomerEvent(event: any) {
    const customerGuid = event.object_guid || event.guid;
    const state = event.state || event.status; // 'verified', 'unverified', 'rejected'

    const customer = await this.prisma.cybridCustomer.findUnique({
      where: { cybridCustomerGuid: customerGuid },
    });

    if (customer) {
      const kybStatus = state === 'verified' ? 'approved' : (state === 'rejected' ? 'rejected' : 'pending');
      const userKybStatus = state === 'verified' ? KybStatus.approved : (state === 'rejected' ? KybStatus.rejected : KybStatus.pending);
      await this.prisma.cybridCustomer.update({
        where: { id: customer.id },
        data: { kybStatus },
      });
      await this.prisma.user.update({
        where: { id: customer.userId },
        data: { kybStatus: userKybStatus },
      });
      if (state === 'verified') {
        await this.accountService.ensureDepositBankAccount(customer.userId);
      }
      await this.auditLogsService.log({
        userId: customer.userId,
        action: `CYBRID_CUSTOMER_STATE_${state.toUpperCase()}`,
        entityType: 'CybridCustomer',
        entityId: customer.id,
        details: { customerGuid, state, kybStatus },
      });
    }
  }

  private async syncLegacyWalletBalance(agencyId: string) {
    try {
      const ledgerBal = await this.ledgerService.getAccountBalance(`AGENCY:${agencyId}:USD`);
      const existing = await this.prisma.wallet.findFirst({ where: { userId: agencyId } });
      if (existing) {
        await this.prisma.wallet.update({
          where: { id: existing.id },
          data: { balance: ledgerBal.balance },
        });
      } else {
        await this.prisma.wallet.create({
          data: {
            walletId: `WAL-AGY-${Math.floor(100000 + Math.random() * 900000)}`,
            userId: agencyId,
            accountType: 'agency',
            balance: ledgerBal.balance,
            currency: 'USD',
            status: 'active',
          },
        });
      }
    } catch (err) {
      this.logger.warn(`Failed to sync legacy wallet balance for agency ${agencyId}: ${err.message}`);
    }
  }
}


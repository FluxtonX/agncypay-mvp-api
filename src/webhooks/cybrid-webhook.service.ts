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

  async processWebhookEvent(rawPayload: any, signature?: string, rawBody?: string): Promise<{ success: boolean; eventId: string; status: string }> {
    const payloadStr = rawBody || (typeof rawPayload === 'string' ? rawPayload : JSON.stringify(rawPayload));
    const event = typeof rawPayload === 'string' ? JSON.parse(rawPayload) : rawPayload;

    const eventId = event.guid || event.id || `evt_${Date.now()}`;
    const eventType = event.event_type || event.type || 'unknown';

    this.logger.log(`Received Cybrid webhook event [${eventId}]: ${eventType}`);

    // 1. Signature check (if signature provided)
    if (signature) {
      const isValid = this.cybridProvider.verifyWebhookSignature(payloadStr, signature);
      if (!isValid) {
        this.logger.warn(`Webhook signature mismatch for event ${eventId}.`);
        if (process.env.CYBRID_ENVIRONMENT === 'production') {
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
      } else if (eventType.startsWith('execution.')) {
        await this.handleExecutionEvent(event);
      } else if (eventType.startsWith('plan.')) {
        await this.handlePlanEvent(event);
      } else if (eventType.startsWith('identity_verification.')) {
        await this.handleIdentityVerificationEvent(event);
      } else if (eventType.startsWith('customer.')) {
        await this.handleCustomerEvent(event);
      } else if (eventType.startsWith('external_bank_account.')) {
        await this.handleExternalBankAccountEvent(event);
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
            status: { in: ['PENDING_FUNDING', 'FUNDED'] },
          },
          orderBy: { createdAt: 'desc' },
        });
      }
    }

    if (payment) {
      // Out-of-order check: if payment is already COMPLETED and incoming is not RETURNED, skip
      if (payment.status === 'COMPLETED' && action !== 'returned') {
        this.logger.log(`Payment ${payment.id} is already in COMPLETED state. Ignoring duplicate/stale transfer event.`);
        return;
      }

      if (action === 'completed' || action === 'settled') {
        // Transition payment state to COMPLETED
        await this.paymentStateService.transition(payment.id, 'COMPLETED', {
          providerRef: transferGuid,
        });

        if (transferGuid && !payment.cybridTransferGuid) {
          await this.prisma.payment.update({
            where: { id: payment.id },
            data: { cybridTransferGuid: transferGuid },
          });
        }

        // Idempotent double-entry journal entry check
        const existingEntry = await this.prisma.journalEntry.findFirst({
          where: {
            referenceId: payment.id,
            referenceType: { in: ['BRAND_PAYMENT_FUNDED', 'BRAND_PAYMENT_FUNDED_WEBHOOK'] },
            status: 'posted',
          },
        });

        if (!existingEntry) {
          // Post double-entry journal entry
          // Debit: CLEARING:CYBRID_DEPOSIT:USD
          // Credit: AGENCY:{agencyId}:USD
          await this.ledgerService.postJournalEntry({
            debitAccountCode: `CLEARING:CYBRID_DEPOSIT:USD`,
            creditAccountCode: `AGENCY:${payment.agencyId}:USD`,
            amount: Number(payment.amount),
            currency: payment.currency,
            referenceType: 'BRAND_PAYMENT_FUNDED_WEBHOOK',
            referenceId: payment.id,
            providerReference: transferGuid || payment.cybridDepositRef || undefined,
            description: `Confirmed inbound payment ${payment.paymentNumber} via Cybrid deposit webhook`,
          });
        }

        // Update linked invoice if present
        if (payment.invoiceId) {
          await this.prisma.invoice.update({
            where: { id: payment.invoiceId },
            data: { status: 'paid' },
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
      // Out-of-order check: if payout already in terminal state, ignore forward event
      if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(payout.status) && action !== 'returned') {
        this.logger.log(`Payout ${payout.id} is already in ${payout.status}. Ignoring stale transfer event.`);
        return;
      }

      if (action === 'completed' || action === 'settled') {
        await this.payoutStateService.transition(payout.id, 'COMPLETED', {
          providerRef: transferGuid,
        });

        // Promote pending reservation to posted
        await this.prisma.journalEntry.updateMany({
          where: {
            referenceId: payout.id,
            referenceType: 'DOMESTIC_TALENT_PAYOUT',
            status: 'pending',
          },
          data: {
            status: 'posted',
            providerReference: transferGuid,
          },
        });
      } else if (action === 'failed' || action === 'returned') {
        await this.payoutStateService.transition(payout.id, action === 'failed' ? 'FAILED' : 'RETURNED', {
          reason: event.failure_code || 'Payout transfer failed or returned',
          stage: 'PAYOUT_SETTLEMENT',
          providerRef: transferGuid,
        });

        // If pending, mark reversed; if already posted, post explicit refund/reversal entry
        const pendingCount = await this.prisma.journalEntry.count({
          where: {
            referenceId: payout.id,
            referenceType: 'DOMESTIC_TALENT_PAYOUT',
            status: 'pending',
          },
        });

        if (pendingCount > 0) {
          await this.prisma.journalEntry.updateMany({
            where: {
              referenceId: payout.id,
              referenceType: 'DOMESTIC_TALENT_PAYOUT',
              status: 'pending',
            },
            data: { status: 'reversed' },
          });
        } else {
          // Reversal entry to return funds to Agency ledger
          await this.ledgerService.postJournalEntry({
            debitAccountCode: `CLEARING:CYBRID_OUTBOUND:USD`,
            creditAccountCode: `AGENCY:${payout.agencyId}:USD`,
            amount: Number(payout.amount),
            currency: payout.currency,
            referenceType: 'PAYOUT_REVERSAL',
            referenceId: payout.id,
            providerReference: transferGuid,
            description: `Reversal of failed payout ${payout.payoutNumber}`,
          });
        }

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
      if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(payout.status)) {
        this.logger.log(`Payout ${payout.id} is already in ${payout.status}. Ignoring trade event.`);
        return;
      }

      if (action === 'completed' || action === 'settled') {
        await this.payoutStateService.transition(payout.id, 'TRADE_COMPLETED', {
          providerRef: tradeGuid,
        });

        // Promote pending FX trade reservation to posted
        await this.prisma.journalEntry.updateMany({
          where: {
            referenceId: payout.id,
            referenceType: 'FX_TRADE_USD_TO_USDC',
            status: 'pending',
          },
          data: {
            status: 'posted',
            providerReference: tradeGuid,
          },
        });
      } else if (action === 'failed') {
        await this.payoutStateService.transition(payout.id, 'FAILED', {
          reason: event.failure_code || 'FX trade failed',
          stage: 'FX_TRADE',
          providerRef: tradeGuid,
        });

        // Reverse the pending reservation
        await this.prisma.journalEntry.updateMany({
          where: {
            referenceId: payout.id,
            referenceType: 'FX_TRADE_USD_TO_USDC',
            status: 'pending',
          },
          data: { status: 'reversed' },
        });

        await this.syncLegacyWalletBalance(payout.agencyId);
      }
    }
  }

  private async handleExecutionEvent(event: any) {
    const executionGuid = event.object_guid || event.guid || event.execution_guid;
    const planGuid = event.plan_guid;
    const action = event.action || event.status || (event.event_type ? event.event_type.split('.')[1] : 'completed');

    const payout = await this.prisma.paymentPayout.findFirst({
      where: {
        OR: [
          ...(executionGuid ? [{ cybridExecutionGuid: executionGuid }] : []),
          ...(planGuid ? [{ cybridPlanGuid: planGuid }] : []),
        ],
      },
    });

    if (payout) {
      if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(payout.status) && action !== 'returned') {
        this.logger.log(`Payout ${payout.id} is already in ${payout.status}. Ignoring execution event.`);
        return;
      }

      if (action === 'completed' || action === 'settled') {
        if (payout.status === 'REMITTANCE_PENDING' || payout.status === 'EXECUTION_PENDING') {
          await this.payoutStateService.transition(payout.id, 'REMITTANCE_PROCESSING', {
            providerRef: executionGuid,
          });
        }
        await this.payoutStateService.transition(payout.id, 'REMITTANCE_COMPLETED', {
          providerRef: executionGuid,
        });
        await this.payoutStateService.transition(payout.id, 'COMPLETED', {
          providerRef: executionGuid,
        });
      } else if (action === 'failed' || action === 'returned') {
        await this.payoutStateService.transition(payout.id, action === 'failed' ? 'FAILED' : 'RETURNED', {
          reason: event.failure_code || 'Remittance execution failed',
          stage: 'REMITTANCE_EXECUTION',
          providerRef: executionGuid,
        });

        // Reversal entry: USDC_TRADING -> USD
        await this.ledgerService.postJournalEntry({
          debitAccountCode: `AGENCY:${payout.agencyId}:USDC_TRADING`,
          creditAccountCode: `AGENCY:${payout.agencyId}:USD`,
          amount: Number(payout.amount),
          currency: 'USD',
          referenceType: 'REMITTANCE_REVERSAL',
          referenceId: payout.id,
          providerReference: executionGuid,
          description: `Reversal of failed remittance execution for payout ${payout.payoutNumber}`,
        });

        await this.syncLegacyWalletBalance(payout.agencyId);
      }
    }
  }

  private async handlePlanEvent(event: any) {
    const planGuid = event.object_guid || event.guid || event.plan_guid;
    const action = event.action || event.status || (event.event_type ? event.event_type.split('.')[1] : 'completed');

    const payout = await this.prisma.paymentPayout.findFirst({
      where: { cybridPlanGuid: planGuid },
    });

    if (payout) {
      if (action === 'failed') {
        await this.payoutStateService.transition(payout.id, 'FAILED', {
          reason: event.failure_code || 'Remittance plan creation failed',
          stage: 'REMITTANCE_PLAN',
          providerRef: planGuid,
        });

        await this.ledgerService.postJournalEntry({
          debitAccountCode: `AGENCY:${payout.agencyId}:USDC_TRADING`,
          creditAccountCode: `AGENCY:${payout.agencyId}:USD`,
          amount: Number(payout.amount),
          currency: 'USD',
          referenceType: 'PLAN_REVERSAL',
          referenceId: payout.id,
          providerReference: planGuid,
          description: `Reversal of failed remittance plan for payout ${payout.payoutNumber}`,
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

  private async handleExternalBankAccountEvent(event: any) {
    const guid = event.object_guid || event.guid || event.external_bank_account_guid;
    const state = event.state || (event.event_type?.endsWith('.completed') ? 'completed' : event.event_type?.endsWith('.failed') ? 'failed' : 'processing');
    const failureCode = event.failure_code;

    if (!guid) return;

    this.logger.log(`Handling external bank account webhook [${guid}] -> state: ${state}`);

    const existing = await this.prisma.cybridExternalBankAccount.findUnique({
      where: { cybridExternalBankGuid: guid },
    });

    if (existing) {
      await this.prisma.cybridExternalBankAccount.update({
        where: { id: existing.id },
        data: {
          status: state,
          failureCode: failureCode || existing.failureCode,
        },
      });

      if (existing.agencyUserId) {
        if (state === 'completed') {
          await this.prisma.bankDetails.updateMany({
            where: { userId: existing.agencyUserId },
            data: { status: 'approved' },
          });
        } else if (state === 'failed') {
          await this.prisma.bankDetails.updateMany({
            where: { userId: existing.agencyUserId },
            data: { status: 'rejected' },
          });
        }
      }

      await this.auditLogsService.log({
        userId: existing.agencyUserId || 'SYSTEM',
        action: `CYBRID_EBA_STATE_${state.toUpperCase()}`,
        entityType: 'CybridExternalBankAccount',
        entityId: existing.id,
        details: { guid, state, failureCode },
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


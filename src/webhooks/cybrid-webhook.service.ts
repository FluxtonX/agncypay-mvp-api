import { Injectable, Logger, Inject } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../modules/audit-logs/audit-logs.service';
import { LedgerService } from '../modules/ledger/ledger.service';
import { PaymentStateService } from '../modules/payments/payment-state.service';
import { PayoutStateService } from '../modules/payouts/payout-state.service';
import { CybridAccountService } from '../modules/cybrid/cybrid-account.service';
import type { IFinancialProvider } from '../core/interfaces/financial-provider.interface';

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

    // 1. Signature check
    if (signature) {
      const isValid = this.cybridProvider.verifyWebhookSignature(payloadStr, signature);
      if (!isValid) {
        this.logger.error(`Webhook signature verification failed for event ${eventId}`);
        throw new Error('Invalid webhook signature');
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
      if (eventType.startsWith('transfer.')) {
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
    const transferGuid = event.object_guid || event.guid;
    const action = event.action || event.status; // 'completed', 'failed', 'returned'

    // Check if this transfer belongs to an inbound Payment
    const payment = await this.prisma.payment.findFirst({
      where: {
        OR: [
          { cybridTransferGuid: transferGuid },
          { cybridDepositRef: event.deposit_account_guid },
        ],
      },
    });

    if (payment) {
      if (action === 'completed') {
        await this.paymentStateService.transition(payment.id, 'COMPLETED', {
          providerRef: transferGuid,
        });

        // Credit Agency ledger
        await this.ledgerService.postJournalEntry({
          debitAccountCode: `CLEARING:CYBRID_DEPOSIT:USD`,
          creditAccountCode: `AGENCY:${payment.agencyId}:USD`,
          amount: payment.amount,
          currency: payment.currency,
          referenceType: 'BRAND_PAYMENT_FUNDED_WEBHOOK',
          referenceId: payment.id,
          providerReference: transferGuid,
          description: `Confirmed inbound payment ${payment.paymentNumber} via Cybrid transfer webhook`,
        });
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
      where: { cybridTransferGuid: transferGuid },
    });

    if (payout) {
      if (action === 'completed') {
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
      }
    }
  }

  private async handleTradeEvent(event: any) {
    const tradeGuid = event.object_guid || event.guid;
    const action = event.action || event.status;

    const payout = await this.prisma.paymentPayout.findFirst({
      where: { cybridTradeGuid: tradeGuid },
    });

    if (payout) {
      if (action === 'completed') {
        await this.payoutStateService.transition(payout.id, 'TRADE_COMPLETED', {
          providerRef: tradeGuid,
        });
      } else if (action === 'failed') {
        await this.payoutStateService.transition(payout.id, 'FAILED', {
          reason: event.failure_code || 'FX trade failed',
          stage: 'FX_TRADE',
          providerRef: tradeGuid,
        });
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
        data: { kybStatus: status },
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
      await this.prisma.cybridCustomer.update({
        where: { id: customer.id },
        data: { kybStatus },
      });
      await this.prisma.user.update({
        where: { id: customer.userId },
        data: { kybStatus },
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
}

import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../modules/ledger/ledger.service';
import { AuditLogsService } from '../modules/audit-logs/audit-logs.service';
import { PayoutStateService } from '../modules/payouts/payout-state.service';
import { PayoutsService } from '../payouts/payouts.service';
import { ConduitProvider } from '../infrastructure/providers/conduit/conduit.provider';
import { toDecimal } from '../common/utils/decimal.util';

@Injectable()
export class ConduitWebhookService {
  private readonly logger = new Logger(ConduitWebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledgerService: LedgerService,
    private readonly auditLogsService: AuditLogsService,
    private readonly payoutStateService: PayoutStateService,
    private readonly payoutsService: PayoutsService,
    private readonly conduitProvider: ConduitProvider,
  ) {}

  async processWebhook(signature: string | undefined, payload: any, rawBody?: Buffer | string) {
    if (signature && rawBody && !this.conduitProvider.verifyWebhookSignature(signature, rawBody)) {
      this.logger.error('Invalid Conduit webhook signature');
      throw new BadRequestException('Invalid webhook signature');
    }

    const event = payload?.event || payload?.type;
    const data = payload?.data || {};

    this.logger.log(`Received Conduit Webhook: ${event} (ID: ${data.id || payload.id})`);

    switch (event) {
      // ─── 1. Payout Settled / Completed ─────────────────────────────
      case 'transfer.completed':
      case 'payout.completed':
      case 'payout.settled': {
        const transferId = data.id || data.transfer_id || data.payout_id;
        const payout = await this.prisma.paymentPayout.findFirst({
          where: {
            OR: [
              transferId ? { conduitPayoutId: transferId } : undefined,
              data.reference ? { payoutNumber: data.reference } : undefined,
            ].filter(Boolean) as any,
          },
        });

        if (payout) {
          await this.payoutStateService.transition(payout.id, 'COMPLETED');
          await this.prisma.paymentPayout.update({
            where: { id: payout.id },
            data: { status: 'COMPLETED' },
          });

          // Promote atomic pending reservation in double-entry ledger to posted
          const refType =
            payout.payoutType === 'domestic'
              ? 'DOMESTIC_TALENT_PAYOUT'
              : payout.payoutType === 'international'
              ? 'FX_TRADE_RESERVATION'
              : 'AGENCY_SELF_WITHDRAWAL';

          await this.payoutsService.promotePendingToPosted(payout.id, refType, transferId);

          await this.auditLogsService.log({
            userId: payout.agencyId,
            action: 'CONDUIT_PAYOUT_SETTLED',
            entityType: 'PaymentPayout',
            entityId: payout.id,
            details: { transferId, payoutNumber: payout.payoutNumber, amount: payout.amount },
          });

          this.logger.log(`Payout ${payout.payoutNumber} marked COMPLETED via Conduit webhook.`);
        }
        break;
      }

      // ─── 2. Payout Failed ──────────────────────────────────────────
      case 'transfer.failed':
      case 'payout.failed': {
        const transferId = data.id || data.transfer_id || data.payout_id;
        const payout = await this.prisma.paymentPayout.findFirst({
          where: {
            OR: [
              transferId ? { conduitPayoutId: transferId } : undefined,
              data.reference ? { payoutNumber: data.reference } : undefined,
            ].filter(Boolean) as any,
          },
        });

        if (payout) {
          await this.payoutStateService.transition(payout.id, 'FAILED');
          await this.prisma.paymentPayout.update({
            where: { id: payout.id },
            data: { status: 'FAILED' },
          });

          // Reverse pending reservation back to Agency available balance
          const refType =
            payout.payoutType === 'domestic'
              ? 'DOMESTIC_TALENT_PAYOUT'
              : payout.payoutType === 'international'
              ? 'FX_TRADE_RESERVATION'
              : 'AGENCY_SELF_WITHDRAWAL';

          await this.payoutsService.reversePendingReservation(payout.id, refType);

          await this.auditLogsService.log({
            userId: payout.agencyId,
            action: 'CONDUIT_PAYOUT_FAILED',
            entityType: 'PaymentPayout',
            entityId: payout.id,
            details: { transferId, payoutNumber: payout.payoutNumber, reason: data.failure_reason },
          });

          this.logger.warn(`Payout ${payout.payoutNumber} marked FAILED via Conduit webhook: ${data.failure_reason}`);
        }
        break;
      }

      // ─── 3. Inbound Deposit into Conduit Virtual Account ───────────
      case 'deposit.received':
      case 'account.deposit':
      case 'virtual_account.deposit': {
        const vaId = data.virtualAccountId || data.virtual_account_id || data.virtual_account;
        const accNum = data.accountNumber || data.account_number;
        const amount = Number(data.amount || 0);

        const virtualAccount = await this.prisma.conduitVirtualAccount.findFirst({
          where: {
            OR: [
              vaId ? { virtualAccountId: vaId } : undefined,
              accNum ? { accountNumber: accNum } : undefined,
            ].filter(Boolean) as any,
          },
          include: {
            conduitCustomer: {
              include: { user: true },
            },
          },
        });

        if (virtualAccount && virtualAccount.conduitCustomer?.user && amount > 0) {
          const user = virtualAccount.conduitCustomer.user;
          const accountCode = user.accountType === 'brand' ? `BRAND:${user.id}:USD` : `AGENCY:${user.id}:USD`;

          // Post Double-Entry Ledger Inbound Deposit
          const debitAccount = await this.ledgerService.getOrCreateAccount({ accountCode: 'CLEARING:INBOUND_DEPOSIT:USD' });
          const creditAccount = await this.ledgerService.getOrCreateAccount({ accountCode });

          await this.prisma.journalEntry.create({
            data: {
              debitAccountId: debitAccount.id,
              creditAccountId: creditAccount.id,
              amount: toDecimal(amount),
              currency: virtualAccount.currency || 'USD',
              status: 'posted',
              postedAt: new Date(),
              referenceType: 'CONDUIT_VIRTUAL_ACCOUNT_DEPOSIT',
              referenceId: data.id || `dep_${Date.now()}`,
              description: `Conduit VA deposit of $${amount.toFixed(2)} to ${virtualAccount.bankName} (${virtualAccount.accountNumber?.slice(-4)})`,
            },
          });

          await this.auditLogsService.log({
            userId: user.id,
            action: 'CONDUIT_DEPOSIT_CREDITED',
            entityType: 'ConduitVirtualAccount',
            entityId: virtualAccount.id,
            details: { amount, accountCode, depositId: data.id },
          });

          this.logger.log(`Conduit Inbound Deposit $${amount} credited to ${accountCode}`);
        }
        break;
      }

      // ─── 4. KYB Onboarding Approved ────────────────────────────────
      case 'onboarding.approved':
      case 'application.approved':
      case 'customer.verified': {
        const appId = data.id || data.applicationId || data.application_id;
        const customerId = data.customerId || data.customer_id;

        const customer = await this.prisma.conduitCustomer.findFirst({
          where: {
            OR: [
              appId ? { applicationId: appId } : undefined,
              customerId ? { conduitCustomerId: customerId } : undefined,
            ].filter(Boolean) as any,
          },
        });

        if (customer) {
          await this.prisma.conduitCustomer.update({
            where: { id: customer.id },
            data: { kybStatus: 'approved', status: 'active' },
          });

          await this.prisma.user.update({
            where: { id: customer.userId },
            data: { kybStatus: 'approved' },
          });

          // Ensure Virtual Account provisioned
          const existingVa = await this.prisma.conduitVirtualAccount.findFirst({
            where: { conduitCustomerId: customer.id },
          });

          if (!existingVa) {
            try {
              const vaData = await this.conduitProvider.createVirtualAccount({
                customerId: customer.conduitCustomerId,
                asset: 'USD',
              });

              await this.prisma.conduitVirtualAccount.create({
                data: {
                  conduitCustomerId: customer.id,
                  virtualAccountId: vaData.id,
                  currency: vaData.currency || 'USD',
                  accountNumber: vaData.accountNumber,
                  routingNumber: vaData.routingNumber,
                  bankName: vaData.bankName,
                  beneficiaryName: vaData.beneficiaryName,
                  status: 'active',
                },
              });
            } catch (err: any) {
              this.logger.warn(`Conduit auto virtual account creation notice: ${err.message}`);
            }
          }

          this.logger.log(`Customer ${customer.conduitCustomerId} / User ${customer.userId} KYB approved via webhook.`);
        }
        break;
      }

      // ─── 5. KYB Onboarding Rejected ────────────────────────────────
      case 'onboarding.rejected':
      case 'application.rejected': {
        const appId = data.id || data.applicationId || data.application_id;
        const customerId = data.customerId || data.customer_id;

        const customer = await this.prisma.conduitCustomer.findFirst({
          where: {
            OR: [
              appId ? { applicationId: appId } : undefined,
              customerId ? { conduitCustomerId: customerId } : undefined,
            ].filter(Boolean) as any,
          },
        });

        if (customer) {
          await this.prisma.conduitCustomer.update({
            where: { id: customer.id },
            data: { kybStatus: 'rejected', status: 'suspended' },
          });

          await this.prisma.user.update({
            where: { id: customer.userId },
            data: { kybStatus: 'rejected' },
          });

          this.logger.warn(`Customer ${customer.conduitCustomerId} / User ${customer.userId} KYB rejected via webhook.`);
        }
        break;
      }

      default:
        this.logger.debug(`Unhandled Conduit webhook event: ${event}`);
    }

    return { received: true, event };
  }
}

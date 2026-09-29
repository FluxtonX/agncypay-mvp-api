import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../modules/ledger/ledger.service';
import { AuditLogsService } from '../modules/audit-logs/audit-logs.service';
import { PayoutStateService } from '../modules/payouts/payout-state.service';
import { ConduitProvider } from '../infrastructure/providers/conduit/conduit.provider';

@Injectable()
export class ConduitWebhookService {
  private readonly logger = new Logger(ConduitWebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledgerService: LedgerService,
    private readonly auditLogsService: AuditLogsService,
    private readonly payoutStateService: PayoutStateService,
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
      case 'transfer.completed':
      case 'payout.completed': {
        const transferId = data.id || data.transfer_id;
        const payout = await this.prisma.paymentPayout.findFirst({
          where: {
            OR: [
              { cybridTransferGuid: transferId },
              { payoutNumber: data.reference },
            ],
          },
        });

        if (payout) {
          await this.payoutStateService.transition(payout.id, 'COMPLETED');
          this.logger.log(`Payout ${payout.payoutNumber} marked COMPLETED via Conduit webhook.`);
        }
        break;
      }

      case 'transfer.failed':
      case 'payout.failed': {
        const transferId = data.id || data.transfer_id;
        const payout = await this.prisma.paymentPayout.findFirst({
          where: {
            OR: [
              { cybridTransferGuid: transferId },
              { payoutNumber: data.reference },
            ],
          },
        });

        if (payout) {
          await this.payoutStateService.transition(payout.id, 'FAILED');
          this.logger.warn(`Payout ${payout.payoutNumber} marked FAILED via Conduit webhook: ${data.failure_reason}`);
        }
        break;
      }

      case 'customer.verified': {
        const customerId = data.id;
        const user = await this.prisma.user.findFirst({
          where: { providerLegalEntityId: customerId },
        });
        if (user) {
          await this.prisma.user.update({
            where: { id: user.id },
            data: { kybStatus: 'approved' },
          });
          this.logger.log(`User ${user.id} KYB marked approved via Conduit webhook.`);
        }
        break;
      }

      default:
        this.logger.debug(`Unhandled Conduit webhook event: ${event}`);
    }

    return { received: true, event };
  }
}

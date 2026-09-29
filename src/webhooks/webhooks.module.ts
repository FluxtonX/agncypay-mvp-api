import { Module } from '@nestjs/common';
import { WebhooksController } from './webhooks.controller';
import { PlaidWebhookService } from './plaid-webhook.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditLogsModule } from '../modules/audit-logs/audit-logs.module';
import { LedgerModule } from '../modules/ledger/ledger.module';
import { PaymentModule } from '../modules/payments/payment.module';
import { PayoutsModule } from '../payouts/payouts.module';

import { ConduitWebhookService } from './conduit-webhook.service';
import { ConduitModule } from '../infrastructure/providers/conduit/conduit.module';

@Module({
  imports: [
    PrismaModule,
    AuditLogsModule,
    LedgerModule,
    PaymentModule,
    PayoutsModule,
    ConduitModule,
  ],
  controllers: [WebhooksController],
  providers: [
    PlaidWebhookService,
    ConduitWebhookService,
  ],
  exports: [PlaidWebhookService, ConduitWebhookService],
})
export class WebhooksModule {}

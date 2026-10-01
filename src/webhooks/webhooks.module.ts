import { Module } from '@nestjs/common';
import { WebhooksController } from './webhooks.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditLogsModule } from '../modules/audit-logs/audit-logs.module';
import { PaymentModule } from '../modules/payments/payment.module';
import { PaymentOrchestrationModule } from '../modules/payment-orchestration/payment-orchestration.module';
import { TalentBalancesModule } from '../modules/talent-balances/talent-balances.module';

import { ConduitWebhookService } from './conduit-webhook.service';
import { PaymentProvidersModule } from '../infrastructure/providers/payment-providers.module';

@Module({
  imports: [
    PrismaModule,
    AuditLogsModule,
    PaymentModule,
    PaymentOrchestrationModule,
    TalentBalancesModule,
    PaymentProvidersModule,
  ],
  controllers: [WebhooksController],
  providers: [ConduitWebhookService],
  exports: [ConduitWebhookService],
})
export class WebhooksModule {}

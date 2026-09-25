import { Module } from '@nestjs/common';
import { WebhooksController } from './webhooks.controller';
import { CybridWebhookService } from './cybrid-webhook.service';
import { PlaidWebhookService } from './plaid-webhook.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditLogsModule } from '../modules/audit-logs/audit-logs.module';
import { LedgerModule } from '../modules/ledger/ledger.module';
import { PaymentModule } from '../modules/payments/payment.module';
import { PayoutsModule } from '../payouts/payouts.module';
import { CybridCustomerService } from '../modules/cybrid/cybrid-customer.service';
import { CybridAccountService } from '../modules/cybrid/cybrid-account.service';

@Module({
  imports: [
    PrismaModule,
    AuditLogsModule,
    LedgerModule,
    PaymentModule,
    PayoutsModule,
  ],
  controllers: [WebhooksController],
  providers: [
    CybridWebhookService,
    PlaidWebhookService,
    CybridCustomerService,
    CybridAccountService,
  ],
  exports: [CybridWebhookService, PlaidWebhookService],
})
export class WebhooksModule {}

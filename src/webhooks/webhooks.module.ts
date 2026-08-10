import { Module } from '@nestjs/common';
import { WebhooksController } from './webhooks.controller';
import { InvoicesModule } from '../invoices/invoices.module';

@Module({
  imports: [InvoicesModule],
  controllers: [WebhooksController],
})
export class WebhooksModule {}

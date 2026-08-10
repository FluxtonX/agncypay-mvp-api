import { Module } from '@nestjs/common';
import { QuickBooksController } from './quickbooks.controller';
import { QuickBooksService } from './quickbooks.service';
import { QuickBooksOAuthService } from './quickbooks-oauth.service';
import { QuickBooksSyncService } from './quickbooks-sync.service';
import { QuickBooksConnectionRepository } from './repositories/quickbooks-connection.repository';
import { QuickBooksInvoiceRepository } from './repositories/quickbooks-invoice.repository';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [QuickBooksController],
  providers: [
    QuickBooksService,
    QuickBooksOAuthService,
    QuickBooksSyncService,
    QuickBooksConnectionRepository,
    QuickBooksInvoiceRepository,
  ],
  exports: [QuickBooksService, QuickBooksSyncService],
})
export class QuickBooksModule {}

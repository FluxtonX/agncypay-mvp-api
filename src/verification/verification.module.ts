import { Module } from '@nestjs/common';
import { VerificationController } from './verification.controller';
import { VerificationService } from './verification.service';
import { PrismaModule } from '../prisma/prisma.module';
import { PlaidProvider } from '../infrastructure/providers/plaid/plaid.provider';
import { AuditLogsModule } from '../modules/audit-logs/audit-logs.module';
import { CybridCustomerService } from '../modules/cybrid/cybrid-customer.service';
import { CybridAccountService } from '../modules/cybrid/cybrid-account.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [VerificationController],
  providers: [
    VerificationService,
    PlaidProvider,
    CybridCustomerService,
    CybridAccountService,
  ],
  exports: [VerificationService],
})
export class VerificationModule {}

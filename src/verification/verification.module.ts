import { Module } from '@nestjs/common';
import { VerificationController } from './verification.controller';
import { VerificationService } from './verification.service';
import { PrismaModule } from '../prisma/prisma.module';
import { PlaidProvider } from '../infrastructure/providers/plaid/plaid.provider';
import { AuditLogsModule } from '../modules/audit-logs/audit-logs.module';
import { ConduitModule } from '../infrastructure/providers/conduit/conduit.module';

@Module({
  imports: [PrismaModule, AuditLogsModule, ConduitModule],
  controllers: [VerificationController],
  providers: [
    VerificationService,
    PlaidProvider,
  ],
  exports: [VerificationService],
})
export class VerificationModule {}

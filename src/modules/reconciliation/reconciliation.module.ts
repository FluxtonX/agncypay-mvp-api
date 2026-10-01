import { Module } from '@nestjs/common';
import { ReconciliationService } from './reconciliation.service';
import { ReconciliationController } from './reconciliation.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { LedgerModule } from '../ledger/ledger.module';
import { PaymentProvidersModule } from '../../infrastructure/providers/payment-providers.module';

@Module({
  imports: [
    PrismaModule,
    AuditLogsModule,
    LedgerModule,
    PaymentProvidersModule,
  ],
  controllers: [ReconciliationController],
  providers: [ReconciliationService],
  exports: [ReconciliationService],
})
export class ReconciliationModule {}

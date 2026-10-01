import { Module } from '@nestjs/common';
import { PaymentService } from './payment.service';
import { PaymentController } from './payment.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { LedgerModule } from '../ledger/ledger.module';
import { PaymentOrchestrationModule } from '../payment-orchestration/payment-orchestration.module';
import { PaymentProvidersModule } from '../../infrastructure/providers/payment-providers.module';
import { TalentBalancesModule } from '../talent-balances/talent-balances.module';

@Module({
  imports: [
    PrismaModule,
    AuditLogsModule,
    LedgerModule,
    PaymentOrchestrationModule,
    PaymentProvidersModule,
    TalentBalancesModule,
  ],
  controllers: [PaymentController],
  providers: [PaymentService],
  exports: [PaymentService],
})
export class PaymentModule {}

import { Module } from '@nestjs/common';
import { PaymentService } from './payment.service';
import { PaymentController } from './payment.controller';
import { PaymentStateService } from './payment-state.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { LedgerModule } from '../ledger/ledger.module';

@Module({
  imports: [PrismaModule, AuditLogsModule, LedgerModule],
  controllers: [PaymentController],
  providers: [
    PaymentService,
    PaymentStateService,
    // TODO: Add Conduit services when ConduitProvider is implemented
  ],
  exports: [PaymentService, PaymentStateService],
})
export class PaymentModule {}

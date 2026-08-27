import { Module } from '@nestjs/common';
import { PaymentService } from './payment.service';
import { PaymentController } from './payment.controller';
import { PaymentStateService } from './payment-state.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { LedgerModule } from '../ledger/ledger.module';
import { CybridCustomerService } from '../cybrid/cybrid-customer.service';
import { CybridAccountService } from '../cybrid/cybrid-account.service';

@Module({
  imports: [PrismaModule, AuditLogsModule, LedgerModule],
  controllers: [PaymentController],
  providers: [
    PaymentService,
    PaymentStateService,
    CybridCustomerService,
    CybridAccountService,
  ],
  exports: [PaymentService, PaymentStateService],
})
export class PaymentModule {}

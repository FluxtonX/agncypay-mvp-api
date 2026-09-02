import { Module } from '@nestjs/common';
import { PayoutsService } from './payouts.service';
import { PayoutsController } from './payouts.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditLogsModule } from '../modules/audit-logs/audit-logs.module';
import { LedgerModule } from '../modules/ledger/ledger.module';
import { CybridCustomerService } from '../modules/cybrid/cybrid-customer.service';
import { CybridAccountService } from '../modules/cybrid/cybrid-account.service';
import { ExternalBankAccountService } from '../modules/cybrid/external-bank-account.service';
import { PayoutStateService } from '../modules/payouts/payout-state.service';
import { PlaidProvider } from '../infrastructure/providers/plaid/plaid.provider';

@Module({
  imports: [PrismaModule, AuditLogsModule, LedgerModule],
  controllers: [PayoutsController],
  providers: [
    PayoutsService,
    PayoutStateService,
    CybridCustomerService,
    CybridAccountService,
    ExternalBankAccountService,
    PlaidProvider,
  ],
  exports: [PayoutsService, PayoutStateService],
})
export class PayoutsModule {}

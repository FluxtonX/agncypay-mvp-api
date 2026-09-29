import { Module } from '@nestjs/common';
import { PayoutsService } from './payouts.service';
import { PayoutsController } from './payouts.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditLogsModule } from '../modules/audit-logs/audit-logs.module';
import { LedgerModule } from '../modules/ledger/ledger.module';
import { PayoutStateService } from '../modules/payouts/payout-state.service';
import { PlaidProvider } from '../infrastructure/providers/plaid/plaid.provider';

import { ConduitModule } from '../infrastructure/providers/conduit/conduit.module';

@Module({
  imports: [PrismaModule, AuditLogsModule, LedgerModule, ConduitModule],
  controllers: [PayoutsController],
  providers: [
    PayoutsService,
    PayoutStateService,
    PlaidProvider,
  ],
  exports: [PayoutsService, PayoutStateService],
})
export class PayoutsModule {}

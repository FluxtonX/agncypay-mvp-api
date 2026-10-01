import { Module } from '@nestjs/common';
import { PaymentOrchestrationModule } from '../payment-orchestration/payment-orchestration.module';
import { TalentBalancesController } from './talent-balances.controller';
import { TalentBalancesService } from './talent-balances.service';
import { LedgerModule } from '../ledger/ledger.module';
import { TalentWithdrawalsService } from './talent-withdrawals.service';
import { PaymentProvidersModule } from '../../infrastructure/providers/payment-providers.module';

@Module({
  imports: [PaymentOrchestrationModule, LedgerModule, PaymentProvidersModule],
  controllers: [TalentBalancesController],
  providers: [TalentBalancesService, TalentWithdrawalsService],
  exports: [TalentBalancesService, TalentWithdrawalsService],
})
export class TalentBalancesModule {}

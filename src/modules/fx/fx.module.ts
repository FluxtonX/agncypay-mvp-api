import { Module } from '@nestjs/common';
import { PaymentProvidersModule } from '../../infrastructure/providers/payment-providers.module';
import { PaymentOrchestrationModule } from '../payment-orchestration/payment-orchestration.module';
import { TalentBalancesModule } from '../talent-balances/talent-balances.module';
import { FxController } from './fx.controller';
import { FxService } from './fx.service';

@Module({
  imports: [
    PaymentProvidersModule,
    PaymentOrchestrationModule,
    TalentBalancesModule,
  ],
  controllers: [FxController],
  providers: [FxService],
  exports: [FxService],
})
export class FxModule {}

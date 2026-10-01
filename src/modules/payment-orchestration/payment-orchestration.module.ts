import { Module } from '@nestjs/common';
import { PaymentOrchestrationService } from './payment-orchestration.service';

@Module({
  providers: [PaymentOrchestrationService],
  exports: [PaymentOrchestrationService],
})
export class PaymentOrchestrationModule {}

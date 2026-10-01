import { Module } from '@nestjs/common';
import { CommercialDocumentsController } from './commercial-documents.controller';
import { CommercialDocumentsService } from './commercial-documents.service';
import { TalentFundingService } from './talent-funding.service';
import { PaymentOrchestrationModule } from '../payment-orchestration/payment-orchestration.module';
import { PaymentProvidersModule } from '../../infrastructure/providers/payment-providers.module';

@Module({
  imports: [PaymentOrchestrationModule, PaymentProvidersModule],
  controllers: [CommercialDocumentsController],
  providers: [CommercialDocumentsService, TalentFundingService],
  exports: [CommercialDocumentsService, TalentFundingService],
})
export class CommercialDocumentsModule {}

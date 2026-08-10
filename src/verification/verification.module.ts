import { Module } from '@nestjs/common';
import { VerificationController } from './verification.controller';
import { VerificationService } from './verification.service';
import { PrismaModule } from '../prisma/prisma.module';
import { PlaidProvider } from '../infrastructure/providers/plaid/plaid.provider';

@Module({
  imports: [PrismaModule],
  controllers: [VerificationController],
  providers: [VerificationService, PlaidProvider],
  exports: [VerificationService],
})
export class VerificationModule {}


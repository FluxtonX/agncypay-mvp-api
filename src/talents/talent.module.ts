import { Module } from '@nestjs/common';
import { TalentBankAccountsService } from './talent-bank-accounts.service';
import { TalentBankAccountsController } from './talent-bank-accounts.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditLogsModule } from '../modules/audit-logs/audit-logs.module';
import { PlaidProvider } from '../infrastructure/providers/plaid/plaid.provider';
import { PaymentProvidersModule } from '../infrastructure/providers/payment-providers.module';

@Module({
  imports: [PrismaModule, AuditLogsModule, PaymentProvidersModule],
  controllers: [TalentBankAccountsController],
  providers: [TalentBankAccountsService, PlaidProvider],
  exports: [TalentBankAccountsService],
})
export class TalentModule {}

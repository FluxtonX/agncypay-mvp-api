import { Module } from '@nestjs/common';
import { TalentService } from './talent.service';
import { TalentController } from './talent.controller';
import { TalentBankAccountsService } from './talent-bank-accounts.service';
import { TalentBankAccountsController } from './talent-bank-accounts.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditLogsModule } from '../modules/audit-logs/audit-logs.module';
import { CybridCustomerService } from '../modules/cybrid/cybrid-customer.service';
import { ExternalBankAccountService } from '../modules/cybrid/external-bank-account.service';
import { PlaidProvider } from '../infrastructure/providers/plaid/plaid.provider';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [TalentController, TalentBankAccountsController],
  providers: [
    TalentService,
    TalentBankAccountsService,
    CybridCustomerService,
    ExternalBankAccountService,
    PlaidProvider,
  ],
  exports: [TalentService, TalentBankAccountsService, ExternalBankAccountService],
})
export class TalentModule {}


import { Module } from '@nestjs/common';
import { TalentService } from './talent.service';
import { TalentController } from './talent.controller';
import { TalentBankAccountsService } from './talent-bank-accounts.service';
import { TalentBankAccountsController } from './talent-bank-accounts.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditLogsModule } from '../modules/audit-logs/audit-logs.module';
import { PlaidProvider } from '../infrastructure/providers/plaid/plaid.provider';
import { ConduitModule } from '../infrastructure/providers/conduit/conduit.module';

@Module({
  imports: [PrismaModule, AuditLogsModule, ConduitModule],
  controllers: [TalentController, TalentBankAccountsController],
  providers: [
    TalentService,
    TalentBankAccountsService,
    PlaidProvider,
  ],
  exports: [TalentService, TalentBankAccountsService],
})
export class TalentModule {}

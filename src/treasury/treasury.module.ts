import { Module } from '@nestjs/common';
import { TreasuryController } from './treasury.controller';
import { TreasuryService } from './treasury.service';
import { PrismaModule } from '../prisma/prisma.module';
import { LedgerModule } from '../modules/ledger/ledger.module';
import { AuditLogsModule } from '../modules/audit-logs/audit-logs.module';

@Module({
  imports: [PrismaModule, LedgerModule, AuditLogsModule],
  controllers: [TreasuryController],
  providers: [TreasuryService],
  exports: [TreasuryService],
})
export class TreasuryModule {}

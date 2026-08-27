import { Module } from '@nestjs/common';
import { TalentService } from './talent.service';
import { TalentController } from './talent.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditLogsModule } from '../modules/audit-logs/audit-logs.module';
import { CybridCustomerService } from '../modules/cybrid/cybrid-customer.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [TalentController],
  providers: [TalentService, CybridCustomerService],
  exports: [TalentService],
})
export class TalentModule {}

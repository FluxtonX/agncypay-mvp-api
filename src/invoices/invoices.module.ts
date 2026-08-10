import { Module } from '@nestjs/common';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';
import { PrismaModule } from '../prisma/prisma.module';
import { InvoiceRepository } from '../infrastructure/database/repositories/invoice.repository';
import { UserRepository } from '../infrastructure/database/repositories/user.repository';
import { ModernTreasuryProvider } from '../infrastructure/providers/modern-treasury/modern-treasury.provider';

@Module({
  imports: [PrismaModule],
  controllers: [InvoicesController],
  providers: [InvoicesService, InvoiceRepository, UserRepository, ModernTreasuryProvider],
  exports: [InvoicesService],
})
export class InvoicesModule {}


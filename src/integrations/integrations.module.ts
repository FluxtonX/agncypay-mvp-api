import { Module } from '@nestjs/common';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsService } from './integrations.service';
import { PrismaModule } from '../prisma/prisma.module';
import { QuickBooksProvider } from '../infrastructure/providers/quickbooks/quickbooks.provider';
import { XeroProvider } from '../infrastructure/providers/xero/xero.provider';
import { SageProvider } from '../infrastructure/providers/sage/sage.provider';

@Module({
  imports: [PrismaModule],
  controllers: [IntegrationsController],
  providers: [IntegrationsService, QuickBooksProvider, XeroProvider, SageProvider],
  exports: [IntegrationsService],
})
export class IntegrationsModule {}

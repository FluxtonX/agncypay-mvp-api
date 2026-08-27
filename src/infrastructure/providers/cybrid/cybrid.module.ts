import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CybridConfigService } from './cybrid-config.service';
import { CybridHttpClient } from './cybrid-http.client';
import { CybridProvider } from './cybrid.provider';

/**
 * CybridModule
 *
 * Global module providing Cybrid infrastructure services.
 * Exports CybridProvider (IFinancialProvider) and CybridConfigService
 * for use by business-layer services.
 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    CybridConfigService,
    CybridHttpClient,
    CybridProvider,
    {
      provide: 'IFinancialProvider',
      useExisting: CybridProvider,
    },
  ],
  exports: [
    CybridConfigService,
    CybridProvider,
    'IFinancialProvider',
  ],
})
export class CybridModule {}

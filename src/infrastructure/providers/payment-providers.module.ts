import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PAYMENT_PROVIDER } from '../../core/interfaces/payment-provider.interface';
import { ConduitProvider } from './conduit/conduit.provider';
import { FakePaymentProvider } from './fake/fake-payment.provider';

@Module({
  imports: [ConfigModule],
  providers: [
    ConduitProvider,
    FakePaymentProvider,
    {
      provide: PAYMENT_PROVIDER,
      inject: [ConfigService, ConduitProvider, FakePaymentProvider],
      useFactory: (
        config: ConfigService,
        conduit: ConduitProvider,
        fake: FakePaymentProvider,
      ) => {
        const selected = config.get<string>('PAYMENT_PROVIDER') || 'conduit';
        if (selected === 'fake') {
          if (config.get<string>('NODE_ENV') === 'production') {
            throw new Error('PAYMENT_PROVIDER=fake is forbidden in production');
          }
          return fake;
        }
        if (selected !== 'conduit') {
          throw new Error(`Unsupported PAYMENT_PROVIDER: ${selected}`);
        }
        return conduit;
      },
    },
  ],
  exports: [PAYMENT_PROVIDER],
})
export class PaymentProvidersModule {}

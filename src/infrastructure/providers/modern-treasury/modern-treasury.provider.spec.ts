import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ModernTreasuryProvider } from './modern-treasury.provider';

describe('ModernTreasuryProvider', () => {
  let provider: ModernTreasuryProvider;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ModernTreasuryProvider,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'MODERN_TREASURY_API_KEY') return null;
              if (key === 'MODERN_TREASURY_ORGANIZATION_ID') return null;
              if (key === 'MODERN_TREASURY_INTERNAL_ACCOUNT_ID') return null;
              if (key === 'MODERN_TREASURY_WEBHOOK_KEY') return 'whsec_test_secret';
              return null;
            }),
          },
        },
      ],
    }).compile();

    provider = module.get<ModernTreasuryProvider>(ModernTreasuryProvider);
  });

  it('should be defined', () => {
    expect(provider).toBeDefined();
  });

  it('should verify simulated webhook signature in dev mode', () => {
    const isValid = provider.verifyWebhookSignature(
      JSON.stringify({ event: 'payment_order.completed' }),
      'simulated_signature_valid',
    );
    expect(isValid).toBe(true);
  });

  it('should process simulated ACH payment request', async () => {
    const response = await provider.processACHPayment({
      invoiceId: 'W-INV-TEST',
      amount: 500,
      currency: 'USD',
      payerUserId: 'user-brand-1',
      recipientUserId: 'user-agency-1',
    });

    expect(response).toBeDefined();
    expect(response.paymentOrderId).toContain('po_simulated_');
    expect(response.status).toBe('processing');
  });

  it('should reject empty signature header', () => {
    const isValid = provider.verifyWebhookSignature(
      JSON.stringify({ event: 'payment_order.completed' }),
      '',
    );
    expect(isValid).toBe(false);
  });
});

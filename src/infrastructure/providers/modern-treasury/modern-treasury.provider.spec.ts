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

  it('should create simulated Legal Entity', async () => {
    const res = await provider.createLegalEntity({
      agencyId: 'agency-1',
      legalName: 'Test Agency Inc',
    });
    expect(res.legalEntityId).toContain('le_simulated_');
    expect(res.status).toBe('approved');
  });

  it('should create simulated Internal Account', async () => {
    const res = await provider.createInternalAccount({
      name: 'Agency Subsection',
      legalEntityId: 'le_simulated_123',
    });
    expect(res.internalAccountId).toContain('ia_simulated_');
    expect(res.ledgerAccountId).toContain('leg_simulated_');
  });

  it('should create simulated External Account', async () => {
    const res = await provider.createExternalAccount({
      counterpartyId: 'cp_123',
      name: 'Agency Payout Bank',
      accountNumber: '987654321',
      routingNumber: '111000025',
    });
    expect(res.externalAccountId).toContain('ea_simulated_');
  });

  it('should retrieve simulated Ledger Account balance', async () => {
    const res = await provider.getLedgerAccountBalance('leg_simulated_123');
    expect(res.postedBalance).toBe(25000);
    expect(res.currency).toBe('USD');
  });

  it('should create simulated payout Payment Order', async () => {
    const res = await provider.createPayout({
      payoutId: 'pout_123',
      agencyId: 'agency-1',
      amount: 1000,
      currency: 'USD',
      originatingInternalAccountId: 'ia_simulated_123',
      receivingExternalAccountId: 'ea_simulated_123',
    });
    expect(res.paymentOrderId).toContain('po_payout_simulated_');
    expect(res.status).toBe('processing');
  });

  it('should reject empty signature header', () => {
    const isValid = provider.verifyWebhookSignature(
      JSON.stringify({ event: 'payment_order.completed' }),
      '',
    );
    expect(isValid).toBe(false);
  });
});

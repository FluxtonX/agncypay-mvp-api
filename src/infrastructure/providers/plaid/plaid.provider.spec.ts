import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PlaidProvider } from './plaid.provider';

describe('PlaidProvider', () => {
  let provider: PlaidProvider;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlaidProvider,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'PLAID_CLIENT_ID') return 'test-plaid-client-id';
              if (key === 'PLAID_SECRET') return 'test-plaid-secret';
              if (key === 'PLAID_ENV') return 'sandbox';
              return null;
            }),
          },
        },
      ],
    }).compile();

    provider = module.get<PlaidProvider>(PlaidProvider);
  });

  it('should be defined', () => {
    expect(provider).toBeDefined();
  });

  it('should create link token or fallback safely in test mode', async () => {
    const res = await provider.createLinkToken('user-123');
    expect(res).toBeDefined();
    expect(res.linkToken).toBeDefined();
    expect(res.expiration).toBeDefined();
  });

  it('should exchange public token or fallback safely in test mode', async () => {
    const res = await provider.exchangePublicToken({ userId: 'user-123', publicToken: 'public-sandbox-token' });
    expect(res).toBeDefined();
    expect(res.accessToken).toBeDefined();
    expect(res.itemId).toBeDefined();
    expect(Array.isArray(res.accounts)).toBe(true);
  });

  it('should create processor token for Modern Treasury', async () => {
    const token = await provider.createProcessorToken('access-sandbox-simulated-user-123', 'acc-123', 'modern_treasury');
    expect(token).toBeDefined();
    expect(token).toContain('processor-token-');
  });
});

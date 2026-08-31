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

    // Mock PlaidApi client methods
    (provider as any).client = {
      linkTokenCreate: jest.fn().mockResolvedValue({
        data: {
          link_token: 'link-sandbox-test-token',
          expiration: '2026-09-01T00:00:00Z',
        },
      }),
      itemPublicTokenExchange: jest.fn().mockResolvedValue({
        data: {
          access_token: 'access-sandbox-test-token',
          item_id: 'item-test-id',
        },
      }),
      authGet: jest.fn().mockResolvedValue({
        data: {
          accounts: [
            {
              account_id: 'acc_123',
              name: 'Plaid Checking',
              mask: '0000',
              balances: { iso_currency_code: 'USD' },
            },
          ],
          numbers: {
            ach: [{ account_id: 'acc_123', routing: '011401533', account: '0000' }],
          },
        },
      }),
      processorTokenCreate: jest.fn().mockResolvedValue({
        data: {
          processor_token: 'processor-token-cybrid-123',
        },
      }),
    };
  });

  it('should be defined', () => {
    expect(provider).toBeDefined();
  });

  it('should create link token in test mode', async () => {
    const res = await provider.createLinkToken('user-123');
    expect(res).toBeDefined();
    expect(res.linkToken).toBe('link-sandbox-test-token');
    expect(res.expiration).toBeDefined();
  });

  it('should exchange public token in test mode', async () => {
    const res = await provider.exchangePublicToken({ userId: 'user-123', publicToken: 'public-sandbox-token' });
    expect(res).toBeDefined();
    expect(res.accessToken).toBe('access-sandbox-test-token');
    expect(res.itemId).toBe('item-test-id');
    expect(Array.isArray(res.accounts)).toBe(true);
  });

  it('should create processor token for payment processor', async () => {
    const token = await provider.createProcessorToken('access-sandbox-simulated-user-123', 'acc-123', 'cybrid');
    expect(token).toBeDefined();
    expect(token).toBe('processor-token-cybrid-123');
  });
});


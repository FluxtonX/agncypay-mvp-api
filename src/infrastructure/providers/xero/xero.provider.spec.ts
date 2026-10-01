import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { XeroProvider } from './xero.provider';

describe('XeroProvider', () => {
  let provider: XeroProvider;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        XeroProvider,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'XERO_CLIENT_ID') return 'test-xero-client-id';
              if (key === 'XERO_CLIENT_SECRET')
                return 'test-xero-client-secret';
              if (key === 'XERO_REDIRECT_URI')
                return 'http://localhost:3001/api/v1/integrations/xero/callback';
              return null;
            }),
          },
        },
      ],
    }).compile();

    provider = module.get<XeroProvider>(XeroProvider);
  });

  afterEach(() => jest.restoreAllMocks());

  it('should be defined', () => {
    expect(provider).toBeDefined();
  });

  it('should generate valid Xero OAuth authorization URL', async () => {
    const url = await provider.getAuthUrl();
    expect(url).toContain('https://login.xero.com/identity/connect/authorize');
    expect(url).toContain('client_id=test-xero-client-id');
    expect(url).toContain('offline_access');
  });

  it('should surface token exchange failures instead of simulating credentials', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockRejectedValueOnce(new Error('network unavailable'));
    await expect(provider.handleCallback('dummy-code')).rejects.toThrow(
      'Xero token exchange failed',
    );
  });

  it('should surface invoice synchronization failures', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockRejectedValueOnce(new Error('network unavailable'));
    await expect(
      provider.getInvoices('access-token', 'tenant-1'),
    ).rejects.toThrow('Xero invoice sync failed');
  });

  it('should surface payment and contact synchronization failures', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockRejectedValue(new Error('network unavailable'));
    await expect(
      provider.getPayouts('access-token', 'tenant-1'),
    ).rejects.toThrow('Xero payment sync failed');
    await expect(
      provider.getVendors('access-token', 'tenant-1'),
    ).rejects.toThrow('Xero contact sync failed');
  });
});

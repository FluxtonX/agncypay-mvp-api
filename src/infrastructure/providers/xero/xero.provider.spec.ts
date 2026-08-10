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
              if (key === 'XERO_CLIENT_SECRET') return 'test-xero-client-secret';
              if (key === 'XERO_REDIRECT_URI') return 'http://localhost:3001/api/v1/integrations/xero/callback';
              return null;
            }),
          },
        },
      ],
    }).compile();

    provider = module.get<XeroProvider>(XeroProvider);
  });

  it('should be defined', () => {
    expect(provider).toBeDefined();
  });

  it('should generate valid Xero OAuth authorization URL', async () => {
    const url = await provider.getAuthUrl();
    expect(url).toContain('https://login.xero.com/identity/connect/authorize');
    expect(url).toContain('client_id=test-xero-client-id');
    expect(url).toContain('offline_access');
  });

  it('should handle simulated callback when no live credentials match or fetch fails', async () => {
    const result = await provider.handleCallback('dummy-code');
    expect(result).toBeDefined();
    expect(result.accessToken).toBeDefined();
    expect(result.refreshToken).toBeDefined();
    expect(result.expiresAt).toBeDefined();
  });

  it('should return mapped invoices in simulated mode', async () => {
    const invoices = await provider.getInvoices('xero-access-simulated-123');
    expect(Array.isArray(invoices)).toBe(true);
    expect(invoices.length).toBeGreaterThan(0);
    expect(invoices[0].id).toBeDefined();
    expect(invoices[0].docNumber).toBeDefined();
  });

  it('should return payouts and vendors in simulated mode', async () => {
    const payouts = await provider.getPayouts('xero-access-simulated-123');
    const vendors = await provider.getVendors('xero-access-simulated-123');
    expect(Array.isArray(payouts)).toBe(true);
    expect(Array.isArray(vendors)).toBe(true);
  });
});

import { ConfigService } from '@nestjs/config';
import { QuickBooksProvider } from './quickbooks.provider';

describe('QuickBooksProvider', () => {
  const config = {
    get: jest.fn((key: string) => {
      const values: Record<string, string> = {
        QBO_CLIENT_ID: 'client-id',
        QBO_CLIENT_SECRET: 'client-secret',
        QBO_REDIRECT_URI:
          'https://app.example.com/api/v1/integrations/quickbooks/callback',
        QBO_ENV: 'sandbox',
      };
      return values[key];
    }),
  } as unknown as ConfigService;

  afterEach(() => jest.restoreAllMocks());

  it('builds an official OAuth URL with caller state', async () => {
    const url = new URL(
      await new QuickBooksProvider(config).getAuthUrl('state-123'),
    );
    expect(url.origin).toBe('https://appcenter.intuit.com');
    expect(url.searchParams.get('client_id')).toBe('client-id');
    expect(url.searchParams.get('state')).toBe('state-123');
    expect(url.searchParams.get('scope')).toContain('quickbooks.accounting');
  });

  it('exchanges an authorization code without persisting tokens locally', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          access_token: 'access-token',
          refresh_token: 'refresh-token',
          expires_in: 3600,
        }),
        { status: 200 },
      ),
    );

    const result = await new QuickBooksProvider(config).handleCallback('code');

    expect(result.accessToken).toBe('access-token');
    expect(result.refreshToken).toBe('refresh-token');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('maps sandbox invoices into the provider-independent invoice shape', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          QueryResponse: {
            Invoice: [
              {
                Id: '42',
                DocNumber: 'INV-42',
                CustomerRef: { name: 'Brand' },
                TotalAmt: 1250,
                DueDate: '2026-11-01',
                Balance: 1250,
              },
            ],
          },
        }),
        { status: 200 },
      ),
    );

    const invoices = await new QuickBooksProvider(config).getInvoices(
      'access-token',
      'realm/one',
    );

    expect(String(fetchMock.mock.calls[0][0])).toContain(
      'sandbox-quickbooks.api.intuit.com/v3/company/realm%2Fone/query',
    );
    expect(invoices).toEqual([
      expect.objectContaining({
        id: '42',
        docNumber: 'INV-42',
        name: 'Brand',
        amount: 1250,
        status: 'pending',
      }),
    ]);
  });
});

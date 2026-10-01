import {
  BadGatewayException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  IAccountingIntegrationProvider,
  SyncedInvoice,
} from '../../../core/interfaces/accounting-provider.interface';

interface QuickBooksTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

interface QuickBooksInvoice {
  Id: string;
  DocNumber?: string;
  CustomerRef?: { name?: string };
  TotalAmt?: number;
  DueDate?: string;
  Balance?: number;
  [key: string]: unknown;
}

@Injectable()
export class QuickBooksProvider implements IAccountingIntegrationProvider {
  private readonly logger = new Logger(QuickBooksProvider.name);
  private readonly clientId?: string;
  private readonly clientSecret?: string;
  private readonly redirectUri: string;
  private readonly environment: 'sandbox' | 'production';

  constructor(config: ConfigService) {
    this.clientId = config.get<string>('QBO_CLIENT_ID');
    this.clientSecret = config.get<string>('QBO_CLIENT_SECRET');
    this.redirectUri =
      config.get<string>('QBO_REDIRECT_URI') ||
      'http://localhost:3001/api/v1/integrations/quickbooks/callback';
    this.environment =
      config.get<string>('QBO_ENV') === 'production' ? 'production' : 'sandbox';
    if (!this.clientId || !this.clientSecret) {
      this.logger.warn(
        'QuickBooks credentials not provided. Connector is unavailable.',
      );
    }
  }

  private credentials() {
    if (!this.clientId || !this.clientSecret) {
      throw new ServiceUnavailableException(
        'QuickBooks OAuth is not configured',
      );
    }
    return { clientId: this.clientId, clientSecret: this.clientSecret };
  }

  getAuthUrl(state = ''): Promise<string> {
    const { clientId } = this.credentials();
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      scope: 'com.intuit.quickbooks.accounting openid',
      state,
    });
    return Promise.resolve(
      `https://appcenter.intuit.com/connect/oauth2?${params}`,
    );
  }

  async handleCallback(
    code: string,
    _realmId?: string,
  ): Promise<{ accessToken: string; refreshToken: string; expiresAt: Date }> {
    const { clientId, clientSecret } = this.credentials();
    try {
      const response = await fetch(
        'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
        {
          method: 'POST',
          headers: {
            Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
            Accept: 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            redirect_uri: this.redirectUri,
          }),
        },
      );
      if (!response.ok) {
        throw new Error(`Intuit returned HTTP ${response.status}`);
      }
      const token = (await response.json()) as QuickBooksTokenResponse;
      if (!token.access_token || !token.refresh_token || !token.expires_in) {
        throw new Error('Intuit returned an incomplete token response');
      }
      return {
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        expiresAt: new Date(Date.now() + token.expires_in * 1000),
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown OAuth error';
      this.logger.error(`QuickBooks OAuth callback failed: ${message}`);
      throw new BadGatewayException(
        `QuickBooks token exchange failed: ${message}`,
      );
    }
  }

  async getInvoices(
    accessToken: string,
    realmId?: string,
  ): Promise<SyncedInvoice[]> {
    this.credentials();
    if (!realmId)
      throw new BadGatewayException('QuickBooks company realm is required');
    try {
      const hostname =
        this.environment === 'production'
          ? 'quickbooks.api.intuit.com'
          : 'sandbox-quickbooks.api.intuit.com';
      const url = new URL(
        `https://${hostname}/v3/company/${encodeURIComponent(realmId)}/query`,
      );
      url.searchParams.set('query', 'select * from Invoice maxresults 20');
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
      });
      if (!response.ok) {
        throw new Error(`QuickBooks returned HTTP ${response.status}`);
      }
      const json = (await response.json()) as {
        QueryResponse?: { Invoice?: QuickBooksInvoice[] };
      };
      return (json.QueryResponse?.Invoice || []).map((invoice) => ({
        id: invoice.Id,
        docNumber: invoice.DocNumber || `INV-${invoice.Id}`,
        name: invoice.CustomerRef?.name || 'QuickBooks Client',
        amount: invoice.TotalAmt || 0,
        dueDate: invoice.DueDate || new Date().toISOString(),
        status: invoice.Balance === 0 ? 'paid' : 'pending',
        raw: invoice,
      }));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown sync error';
      this.logger.error(`Failed to fetch QuickBooks invoices: ${message}`);
      throw new BadGatewayException(
        `QuickBooks invoice sync failed: ${message}`,
      );
    }
  }
}

import {
  BadGatewayException,
  Injectable,
  Logger,
  NotImplementedException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  IAccountingIntegrationProvider,
  SyncedInvoice,
} from '../../../core/interfaces/accounting-provider.interface';

@Injectable()
export class SageProvider implements IAccountingIntegrationProvider {
  private readonly logger = new Logger(SageProvider.name);
  private clientId: string | null = null;
  private clientSecret: string | null = null;
  private redirectUri: string;

  constructor(private readonly configService: ConfigService) {
    this.clientId = this.configService.get<string>('SAGE_CLIENT_ID') || null;
    this.clientSecret =
      this.configService.get<string>('SAGE_CLIENT_SECRET') || null;
    this.redirectUri =
      this.configService.get<string>('SAGE_REDIRECT_URI') ||
      'http://localhost:3001/api/v1/integrations/sage/callback';

    if (!this.clientId || !this.clientSecret) {
      this.logger.warn(
        'Sage credentials not provided. Connector is unavailable.',
      );
    }
  }

  async getAuthUrl(state = ''): Promise<string> {
    if (!this.clientId || !this.clientSecret) {
      throw new ServiceUnavailableException('Sage OAuth is not configured');
    }

    const scope = encodeURIComponent('full_access');
    return `https://www.sageone.com/oauth2/auth/central?response_type=code&client_id=${this.clientId}&redirect_uri=${encodeURIComponent(
      this.redirectUri,
    )}&scope=${scope}&state=${encodeURIComponent(state)}`;
  }

  async handleCallback(
    code: string,
    realmId?: string,
  ): Promise<{ accessToken: string; refreshToken: string; expiresAt: Date }> {
    if (!this.clientId || !this.clientSecret) {
      throw new ServiceUnavailableException('Sage OAuth is not configured');
    }

    try {
      const response = await fetch('https://oauth.accounting.sage.com/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: this.clientId,
          client_secret: this.clientSecret,
          code,
          redirect_uri: this.redirectUri,
        }).toString(),
      });

      const token = await response.json();
      if (!response.ok || !token.access_token || !token.refresh_token) {
        throw new Error(
          `Sage token exchange failed with HTTP ${response.status}`,
        );
      }
      return {
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        expiresAt: new Date(Date.now() + (token.expires_in || 3600) * 1000),
      };
    } catch (err: any) {
      this.logger.error(`Sage OAuth callback failed: ${err.message}`);
      throw new BadGatewayException(
        `Sage token exchange failed: ${err.message}`,
      );
    }
  }

  async getInvoices(
    accessToken: string,
    companyId?: string,
  ): Promise<SyncedInvoice[]> {
    if (!this.clientId) {
      throw new ServiceUnavailableException('Sage connector is not configured');
    }

    try {
      const response = await fetch(
        'https://api.accounting.sage.com/v3.1/sales_invoices',
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/json',
          },
        },
      );

      if (!response.ok)
        throw new Error(`Sage invoice API HTTP ${response.status}`);
      const data = await response.json();
      const invoices = data.$items || [];

      return invoices.map((inv: any) => ({
        id: inv.id || `sage-${inv.displayed_as}`,
        docNumber: inv.displayed_as || `S-${inv.id}`,
        name: inv.contact?.name || 'Sage Customer',
        amount: inv.total_amount || 0,
        dueDate: inv.due_date || new Date().toISOString(),
        status: inv.status?.id === 'PAID' ? 'paid' : 'pending',
        raw: inv,
      }));
    } catch (err: any) {
      this.logger.error(`Failed to fetch Sage invoices: ${err.message}`);
      throw new BadGatewayException(`Sage invoice sync failed: ${err.message}`);
    }
  }

  async getPayouts(accessToken: string, companyId?: string): Promise<any[]> {
    throw new NotImplementedException('Sage payout import is not implemented');
  }

  async getVendors(accessToken: string, companyId?: string): Promise<any[]> {
    throw new NotImplementedException('Sage vendor import is not implemented');
  }
}

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

export interface XeroTokenResult {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  tenantId?: string;
  tenantName?: string;
}

@Injectable()
export class XeroProvider implements IAccountingIntegrationProvider {
  private readonly logger = new Logger(XeroProvider.name);
  private clientId: string | null = null;
  private clientSecret: string | null = null;
  private redirectUri: string;

  constructor(private readonly configService: ConfigService) {
    this.clientId = this.configService.get<string>('XERO_CLIENT_ID') || null;
    this.clientSecret =
      this.configService.get<string>('XERO_CLIENT_SECRET') || null;
    this.redirectUri =
      this.configService.get<string>('XERO_REDIRECT_URI') ||
      'http://localhost:3001/api/v1/integrations/xero/callback';

    if (!this.clientId || !this.clientSecret) {
      this.logger.warn(
        'Xero credentials not provided. Connector is unavailable.',
      );
    }
  }

  async getAuthUrl(state = ''): Promise<string> {
    if (!this.clientId || !this.clientSecret) {
      throw new ServiceUnavailableException('Xero OAuth is not configured');
    }

    const scope = encodeURIComponent(
      'accounting.transactions.read accounting.contacts.read offline_access',
    );
    return `https://login.xero.com/identity/connect/authorize?response_type=code&client_id=${this.clientId}&redirect_uri=${encodeURIComponent(
      this.redirectUri,
    )}&scope=${scope}&state=${encodeURIComponent(state)}`;
  }

  async handleCallback(
    code: string,
    tenantIdParam?: string,
  ): Promise<XeroTokenResult> {
    if (!this.clientId || !this.clientSecret) {
      throw new ServiceUnavailableException('Xero OAuth is not configured');
    }

    try {
      const authHeader = Buffer.from(
        `${this.clientId}:${this.clientSecret}`,
      ).toString('base64');
      const tokenResponse = await fetch(
        'https://identity.xero.com/connect/token',
        {
          method: 'POST',
          headers: {
            Authorization: `Basic ${authHeader}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            redirect_uri: this.redirectUri,
          }).toString(),
        },
      );

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        throw new Error(
          `Token exchange failed (${tokenResponse.status}): ${errorText}`,
        );
      }

      const token = await tokenResponse.json();
      const accessToken = token.access_token;
      const refreshToken = token.refresh_token;
      const expiresAt = new Date(
        Date.now() + (token.expires_in || 1800) * 1000,
      );

      // Query Xero Connections API to resolve tenantId and tenantName
      let tenantId = tenantIdParam;
      let tenantName = 'Xero Organization';

      try {
        const connResponse = await fetch('https://api.xero.com/connections', {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Content: 'application/json',
          },
        });
        if (connResponse.ok) {
          const connections = await connResponse.json();
          if (Array.isArray(connections) && connections.length > 0) {
            tenantId = connections[0].tenantId || connections[0].id;
            tenantName = connections[0].tenantName || tenantName;
          }
        }
      } catch (connErr: any) {
        this.logger.warn(
          `Failed to resolve Xero tenant connections: ${connErr.message}`,
        );
      }

      return {
        accessToken,
        refreshToken,
        expiresAt,
        tenantId,
        tenantName,
      };
    } catch (err: any) {
      this.logger.error(
        `Xero OAuth callback failed: ${err.message}`,
        err.stack,
      );
      throw new BadGatewayException(
        `Xero token exchange failed: ${err.message}`,
      );
    }
  }

  async refreshAccessToken(refreshToken: string): Promise<XeroTokenResult> {
    if (!this.clientId || !this.clientSecret) {
      throw new ServiceUnavailableException('Xero OAuth is not configured');
    }

    try {
      const authHeader = Buffer.from(
        `${this.clientId}:${this.clientSecret}`,
      ).toString('base64');
      const response = await fetch('https://identity.xero.com/connect/token', {
        method: 'POST',
        headers: {
          Authorization: `Basic ${authHeader}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
        }).toString(),
      });

      if (!response.ok) {
        throw new Error(`Token refresh HTTP ${response.status}`);
      }

      const token = await response.json();
      return {
        accessToken: token.access_token,
        refreshToken: token.refresh_token || refreshToken,
        expiresAt: new Date(Date.now() + (token.expires_in || 1800) * 1000),
      };
    } catch (err: any) {
      this.logger.error(`Failed to refresh Xero access token: ${err.message}`);
      throw err;
    }
  }

  async getInvoices(
    accessToken: string,
    tenantId?: string,
  ): Promise<SyncedInvoice[]> {
    if (!this.clientId) {
      throw new ServiceUnavailableException('Xero connector is not configured');
    }

    try {
      const response = await fetch(
        'https://api.xero.com/api.xro/2.0/Invoices',
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'xero-tenant-id': tenantId || '',
            Accept: 'application/json',
          },
        },
      );

      if (!response.ok) {
        throw new Error(`Xero API error HTTP ${response.status}`);
      }

      const data = await response.json();
      const invoices = data.Invoices || [];

      return invoices.map((inv: any) => ({
        id: inv.InvoiceID || `xero-${inv.InvoiceNumber}`,
        docNumber: inv.InvoiceNumber || `XERO-${inv.InvoiceID}`,
        name: inv.Contact?.Name || 'Xero Client',
        amount: inv.Total || 0,
        dueDate: inv.DueDateString || inv.DueDate || new Date().toISOString(),
        status: this.mapXeroInvoiceStatus(inv.Status),
        raw: inv,
      }));
    } catch (err: any) {
      this.logger.error(`Failed to fetch Xero invoices: ${err.message}`);
      throw new BadGatewayException(`Xero invoice sync failed: ${err.message}`);
    }
  }

  async getPayouts(accessToken: string, tenantId?: string): Promise<any[]> {
    if (!this.clientId) {
      throw new ServiceUnavailableException('Xero connector is not configured');
    }

    try {
      const response = await fetch(
        'https://api.xero.com/api.xro/2.0/Payments',
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'xero-tenant-id': tenantId || '',
            Accept: 'application/json',
          },
        },
      );

      if (!response.ok) {
        throw new Error(`Xero Payments API HTTP ${response.status}`);
      }

      const data = await response.json();
      const payments = data.Payments || [];

      return payments.map((pay: any) => ({
        id: pay.PaymentID || `pay-${Date.now()}`,
        vendorName:
          pay.Invoice?.Contact?.Name || pay.Account?.Name || 'Xero Payee',
        description:
          pay.Reference ||
          `Payment for ${pay.Invoice?.InvoiceNumber || 'Invoice'}`,
        amount: `$${(pay.Amount || 0).toLocaleString()}`,
        paymentMethod: pay.PaymentType || 'ACH',
        status:
          pay.Status === 'AUTHORISED' || pay.Status === 'PAID'
            ? 'Paid'
            : 'Pending',
        raw: pay,
      }));
    } catch (err: any) {
      this.logger.error(`Failed to fetch Xero payments: ${err.message}`);
      throw new BadGatewayException(`Xero payment sync failed: ${err.message}`);
    }
  }

  async getVendors(accessToken: string, tenantId?: string): Promise<any[]> {
    if (!this.clientId) {
      throw new ServiceUnavailableException('Xero connector is not configured');
    }

    try {
      const response = await fetch(
        'https://api.xero.com/api.xro/2.0/Contacts?where=IsSupplier==true',
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'xero-tenant-id': tenantId || '',
            Accept: 'application/json',
          },
        },
      );

      if (!response.ok) {
        throw new Error(`Xero Contacts API HTTP ${response.status}`);
      }

      const data = await response.json();
      const contacts = data.Contacts || [];

      return contacts.map((c: any) => ({
        id: c.ContactID,
        name: c.Name,
        email: c.EmailAddress || '',
        phone: c.Phones && c.Phones[0] ? c.Phones[0].PhoneNumber : '',
      }));
    } catch (err: any) {
      this.logger.error(`Failed to fetch Xero contacts: ${err.message}`);
      throw new BadGatewayException(`Xero contact sync failed: ${err.message}`);
    }
  }

  private mapXeroInvoiceStatus(
    status: string,
  ): 'paid' | 'pending' | 'cancelled' {
    switch (status?.toUpperCase()) {
      case 'PAID':
        return 'paid';
      case 'VOIDED':
      case 'DELETED':
        return 'cancelled';
      case 'AUTHORISED':
      case 'SUBMITTED':
      case 'DRAFT':
      default:
        return 'pending';
    }
  }
}

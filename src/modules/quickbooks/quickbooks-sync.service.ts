import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OAuthClient from 'intuit-oauth';
import { QuickBooksInvoiceRepository } from './repositories/quickbooks-invoice.repository';
import { QuickBooksConnectionRepository } from './repositories/quickbooks-connection.repository';
import { QuickBooksOAuthService } from './quickbooks-oauth.service';
import { QuickBooksConnectStatus } from '@prisma/client';

@Injectable()
export class QuickBooksSyncService {
  private readonly logger = new Logger(QuickBooksSyncService.name);
  private oauthClient: OAuthClient | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly oauthService: QuickBooksOAuthService,
    private readonly connectionRepo: QuickBooksConnectionRepository,
    private readonly invoiceRepo: QuickBooksInvoiceRepository,
  ) {
    const clientId = this.configService.get<string>('QUICKBOOKS_CLIENT_ID');
    const clientSecret = this.configService.get<string>('QUICKBOOKS_CLIENT_SECRET');
    const redirectUri = this.configService.get<string>('QUICKBOOKS_REDIRECT_URI') || 'http://localhost:3001/api/v1/quickbooks/callback';
    const environment = (this.configService.get<string>('QUICKBOOKS_ENVIRONMENT') || 'sandbox') as any;

    if (clientId && clientSecret) {
      this.oauthClient = new OAuthClient({
        clientId,
        clientSecret,
        environment,
        redirectUri,
      });
    }
  }

  async fetchAndSyncInvoices(agencyId: string) {
    await this.connectionRepo.updateStatus(agencyId, QuickBooksConnectStatus.syncing);

    try {
      const { accessToken, realmId } = await this.oauthService.getValidAccessToken(agencyId);

      if (!this.oauthClient || accessToken.includes('simulated')) {
        this.logger.log(`Simulating QuickBooks invoice sync for agency ${agencyId}`);
        const mockInvoices = [
          {
            quickbooksInvoiceId: `qbo-inv-101`,
            invoiceNumber: 'QBO-1001',
            customerName: 'Nike Global Campaign (QBO)',
            amount: 45000,
            currency: 'USD',
            issueDate: new Date().toISOString().split('T')[0],
            dueDate: '2026-08-30',
            status: 'pending',
            rawPayload: { simulated: true },
          },
          {
            quickbooksInvoiceId: `qbo-inv-102`,
            invoiceNumber: 'QBO-1002',
            customerName: 'Adidas Social Activation (QBO)',
            amount: 28500,
            currency: 'USD',
            issueDate: new Date().toISOString().split('T')[0],
            dueDate: '2026-08-15',
            status: 'paid',
            rawPayload: { simulated: true },
          },
        ];

        for (const inv of mockInvoices) {
          await this.invoiceRepo.upsertInvoice({
            agencyId,
            ...inv,
          });
        }

        await this.connectionRepo.updateStatus(agencyId, QuickBooksConnectStatus.connected, undefined, new Date());
        return this.invoiceRepo.findByAgencyId(agencyId);
      }

      const url = `https://sandbox-quickbooks.api.intuit.com/v3/company/${realmId}/query?query=select * from Invoice maxresults 50`;
      const response: any = await this.oauthClient.makeApiCall({
        url,
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
      });

      const json = response.getJson ? response.getJson() : JSON.parse(response.body || '{}');
      const invoices = json.QueryResponse?.Invoice || [];

      for (const inv of invoices) {
        await this.invoiceRepo.upsertInvoice({
          agencyId,
          quickbooksInvoiceId: String(inv.Id),
          invoiceNumber: inv.DocNumber || `INV-${inv.Id}`,
          customerName: inv.CustomerRef?.name || 'QuickBooks Client',
          amount: parseFloat(inv.TotalAmt || 0),
          currency: inv.CurrencyRef?.value || 'USD',
          issueDate: inv.TxnDate || new Date().toISOString().split('T')[0],
          dueDate: inv.DueDate || new Date().toISOString().split('T')[0],
          status: inv.Balance === 0 ? 'paid' : 'pending',
          rawPayload: inv,
        });
      }

      await this.connectionRepo.updateStatus(agencyId, QuickBooksConnectStatus.connected, undefined, new Date());
      return this.invoiceRepo.findByAgencyId(agencyId);
    } catch (err: any) {
      this.logger.error(`Failed to sync QuickBooks invoices for agency ${agencyId}: ${err.message}`);
      await this.connectionRepo.updateStatus(agencyId, QuickBooksConnectStatus.sync_failed, err.message);
      throw err;
    }
  }
}

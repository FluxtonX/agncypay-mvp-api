import { Injectable } from '@nestjs/common';
import { QuickBooksOAuthService } from './quickbooks-oauth.service';
import { QuickBooksSyncService } from './quickbooks-sync.service';
import { QuickBooksConnectionRepository } from './repositories/quickbooks-connection.repository';
import { QuickBooksInvoiceRepository } from './repositories/quickbooks-invoice.repository';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { QuickBooksConnectStatus } from '@prisma/client';

@Injectable()
export class QuickBooksService {
  constructor(
    private readonly oauthService: QuickBooksOAuthService,
    private readonly syncService: QuickBooksSyncService,
    private readonly connectionRepo: QuickBooksConnectionRepository,
    private readonly invoiceRepo: QuickBooksInvoiceRepository,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  getConnectUrl(agencyId: string): { url: string } {
    const url = this.oauthService.getAuthUrl(agencyId);
    return { url };
  }

  async handleCallback(code: string, realmId: string, state: string): Promise<string> {
    const redirectUrl = await this.oauthService.handleCallback(code, realmId, state);
    const agencyId = state ? state.replace('agency_', '') : '';
    if (agencyId) {
      await this.auditLogsService.log({
        userId: agencyId,
        action: 'QUICKBOOKS_CONNECTED',
        entityType: 'QuickBooksConnection',
        entityId: agencyId,
        details: { realmId },
      });
    }
    return redirectUrl;
  }

  async disconnect(agencyId: string) {
    const conn = await this.connectionRepo.disconnect(agencyId);
    await this.auditLogsService.log({
      userId: agencyId,
      action: 'QUICKBOOKS_DISCONNECTED',
      entityType: 'QuickBooksConnection',
      entityId: agencyId,
    });
    return { status: QuickBooksConnectStatus.disconnected, message: 'QuickBooks disconnected successfully.' };
  }

  async getStatus(agencyId: string) {
    const conn = await this.connectionRepo.findByAgencyId(agencyId);
    if (!conn) {
      return {
        status: QuickBooksConnectStatus.disconnected,
        connected: false,
        realmId: null,
        lastSync: null,
        lastError: null,
      };
    }

    return {
      status: conn.status,
      connected: conn.status === QuickBooksConnectStatus.connected || conn.status === QuickBooksConnectStatus.syncing,
      realmId: conn.realmId,
      lastSync: conn.lastSync,
      lastError: conn.lastError,
    };
  }

  async fetchInvoices(agencyId: string) {
    const invoices = await this.syncService.fetchAndSyncInvoices(agencyId);
    await this.auditLogsService.log({
      userId: agencyId,
      action: 'QUICKBOOKS_INVOICES_FETCHED',
      entityType: 'QuickBooksInvoice',
      entityId: agencyId,
      details: { count: invoices.length },
    });
    return { success: true, count: invoices.length, invoices };
  }

  async getInvoices(agencyId: string) {
    return this.invoiceRepo.findByAgencyId(agencyId);
  }
}

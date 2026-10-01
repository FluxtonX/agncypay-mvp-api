import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { QuickBooksProvider } from '../infrastructure/providers/quickbooks/quickbooks.provider';
import { XeroProvider } from '../infrastructure/providers/xero/xero.provider';
import { SageProvider } from '../infrastructure/providers/sage/sage.provider';
import { AuditLogsService } from '../modules/audit-logs/audit-logs.service';
import { SourceConnectionsService } from '../modules/source-connections/source-connections.service';

@Injectable()
export class IntegrationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly quickBooksProvider: QuickBooksProvider,
    private readonly xeroProvider: XeroProvider,
    private readonly sageProvider: SageProvider,
    private readonly auditLogsService: AuditLogsService,
    private readonly sourceConnections: SourceConnectionsService,
  ) {}

  async getStatus(userId: string) {
    const connections =
      await this.sourceConnections.listOrganizationConnections(userId);
    const qboConnected = connections.some(
      (c) => c.connectorKey === 'quickbooks' && c.status === 'active',
    );
    const xeroConnected = connections.some(
      (c) => c.connectorKey === 'xero' && c.status === 'active',
    );
    const sageConnected = connections.some(
      (c) => c.connectorKey === 'sage' && c.status === 'active',
    );

    return { connections, qboConnected, xeroConnected, sageConnected };
  }

  // ────────────── QUICKBOOKS ──────────────
  async getQuickBooksAuthUrl(userId: string, returnTo?: string) {
    const state = await this.sourceConnections.issueOAuthState(
      userId,
      'quickbooks',
      returnTo,
    );
    const url = await this.quickBooksProvider.getAuthUrl(state);
    return { url };
  }

  async completeQuickBooksCallback(
    code: string,
    realmId: string,
    state: string,
  ) {
    const oauthState = await this.sourceConnections.consumeOAuthState(
      state,
      'quickbooks',
    );
    await this.handleQuickBooksCallback(oauthState.createdById, code, realmId);
    return oauthState.returnTo;
  }

  async handleQuickBooksCallback(
    userId: string,
    code: string,
    realmId?: string,
  ) {
    const tokens = await this.quickBooksProvider.handleCallback(code, realmId);
    if (!realmId)
      throw new BadRequestException('QuickBooks realmId is required');
    const connection =
      await this.sourceConnections.upsertOrganizationConnection({
        userId,
        connectorKey: 'quickbooks',
        externalTenantId: realmId,
        displayName: 'QuickBooks Company',
        credentials: {
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          expiresAt: tokens.expiresAt?.toISOString(),
        },
        status: 'active',
      });

    await this.auditLogsService.log({
      userId,
      action: 'INTEGRATION_CONNECTED',
      entityType: 'IntegrationConnection',
      entityId: connection.id,
      details: { provider: 'quickbooks', realmId },
    });

    return { success: true, connection };
  }

  async getQuickBooksInvoices(userId: string) {
    const conn = (
      await this.sourceConnections.listOrganizationConnections(userId)
    ).find(
      (item) => item.connectorKey === 'quickbooks' && item.status === 'active',
    );
    if (!conn)
      throw new NotFoundException('Active QuickBooks connection not found');
    const full = await this.prisma.sourceConnection.findUniqueOrThrow({
      where: { id: conn.id },
    });
    const credentials = this.sourceConnections.readCredentials(full);
    const accessToken = String(credentials.accessToken || '');
    const realmId = conn.externalTenantId;
    if (!accessToken)
      throw new BadRequestException(
        'QuickBooks connection credentials require reconnection',
      );

    const invoices = await this.quickBooksProvider.getInvoices(
      accessToken,
      realmId,
    );

    await this.auditLogsService.log({
      userId,
      action: 'INTEGRATION_INVOICES_SYNCED',
      entityType: 'IntegrationConnection',
      details: { provider: 'quickbooks', count: invoices.length },
    });

    return { invoices, connected: true, connectionId: conn.id };
  }

  // ────────────── XERO ──────────────
  async getXeroAuthUrl(userId: string, returnTo?: string) {
    const state = await this.sourceConnections.issueOAuthState(
      userId,
      'xero',
      returnTo,
    );
    const url = await this.xeroProvider.getAuthUrl(state);
    return { url };
  }

  async completeXeroCallback(
    code: string,
    tenantId: string | undefined,
    state: string,
  ) {
    const oauthState = await this.sourceConnections.consumeOAuthState(
      state,
      'xero',
    );
    await this.handleXeroCallback(oauthState.createdById, code, tenantId);
    return oauthState.returnTo;
  }

  async handleXeroCallback(
    userId: string,
    code: string,
    tenantIdParam?: string,
  ) {
    const tokens = await this.xeroProvider.handleCallback(code, tenantIdParam);
    const resolvedTenantId = tokens.tenantId || tenantIdParam;

    if (!resolvedTenantId)
      throw new BadRequestException('Xero tenant ID is required');
    const connection =
      await this.sourceConnections.upsertOrganizationConnection({
        userId,
        connectorKey: 'xero',
        externalTenantId: resolvedTenantId,
        displayName: tokens.tenantName || 'Xero Organization',
        credentials: {
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          expiresAt: tokens.expiresAt?.toISOString(),
        },
        status: 'active',
      });

    await this.auditLogsService.log({
      userId,
      action: 'INTEGRATION_CONNECTED',
      entityType: 'IntegrationConnection',
      entityId: connection.id,
      details: {
        provider: 'xero',
        tenantId: resolvedTenantId,
        tenantName: tokens.tenantName,
      },
    });

    return { success: true, connection };
  }

  async getXeroInvoices(userId: string) {
    const summary = (
      await this.sourceConnections.listOrganizationConnections(userId)
    ).find((item) => item.connectorKey === 'xero' && item.status === 'active');
    if (!summary)
      throw new NotFoundException('Active Xero connection not found');
    let conn = await this.prisma.sourceConnection.findUniqueOrThrow({
      where: { id: summary.id },
    });
    let credentials = this.sourceConnections.readCredentials(conn);
    let accessToken = String(credentials.accessToken || '');
    const tenantId = conn.externalTenantId;
    if (!accessToken)
      throw new BadRequestException(
        'Xero connection credentials require reconnection',
      );

    // Auto-refresh token if expired or close to expiration (within 5 minutes)
    if (
      conn &&
      credentials.refreshToken &&
      credentials.expiresAt &&
      new Date(String(credentials.expiresAt)).getTime() - Date.now() <
        300 * 1000
    ) {
      try {
        const refreshed = await this.xeroProvider.refreshAccessToken(
          String(credentials.refreshToken),
        );
        await this.sourceConnections.upsertOrganizationConnection({
          userId,
          connectorKey: 'xero',
          externalTenantId: tenantId,
          displayName: conn.displayName,
          credentials: {
            accessToken: refreshed.accessToken,
            refreshToken: refreshed.refreshToken,
            expiresAt: refreshed.expiresAt?.toISOString(),
          },
          status: 'active',
        });
        accessToken = refreshed.accessToken;
      } catch (err: any) {
        await this.prisma.sourceConnection.update({
          where: { id: conn.id },
          data: { status: 'expired', lastError: err.message },
        });
        throw err;
      }
    }

    const invoices = await this.xeroProvider.getInvoices(accessToken, tenantId);
    const payouts = await this.xeroProvider.getPayouts(accessToken, tenantId);
    const vendors = await this.xeroProvider.getVendors(accessToken, tenantId);

    await this.auditLogsService.log({
      userId,
      action: 'INTEGRATION_INVOICES_SYNCED',
      entityType: 'IntegrationConnection',
      details: {
        provider: 'xero',
        invoiceCount: invoices.length,
        payoutCount: payouts.length,
      },
    });

    return {
      invoices,
      payouts,
      vendors,
      connected: true,
      tenantId,
      institutionName: conn.displayName || 'Xero Organization',
    };
  }

  // ────────────── SAGE ──────────────
  async getSageAuthUrl(userId: string, returnTo?: string) {
    const state = await this.sourceConnections.issueOAuthState(
      userId,
      'sage',
      returnTo,
    );
    const url = await this.sageProvider.getAuthUrl(state);
    return { url };
  }

  async completeSageCallback(
    code: string,
    realmId: string | undefined,
    state: string,
  ) {
    const oauthState = await this.sourceConnections.consumeOAuthState(
      state,
      'sage',
    );
    await this.handleSageCallback(oauthState.createdById, code, realmId);
    return oauthState.returnTo;
  }

  async handleSageCallback(userId: string, code: string, realmId?: string) {
    const tokens = await this.sageProvider.handleCallback(code, realmId);
    if (!realmId) throw new BadRequestException('Sage realm ID is required');
    const connection =
      await this.sourceConnections.upsertOrganizationConnection({
        userId,
        connectorKey: 'sage',
        externalTenantId: realmId,
        displayName: 'Sage Company',
        credentials: {
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          expiresAt: tokens.expiresAt?.toISOString(),
        },
        status: 'active',
      });

    await this.auditLogsService.log({
      userId,
      action: 'INTEGRATION_CONNECTED',
      entityType: 'IntegrationConnection',
      entityId: connection.id,
      details: { provider: 'sage', realmId },
    });

    return { success: true, connection };
  }

  async getSageInvoices(userId: string) {
    const summary = (
      await this.sourceConnections.listOrganizationConnections(userId)
    ).find((item) => item.connectorKey === 'sage' && item.status === 'active');
    if (!summary)
      throw new NotFoundException('Active Sage connection not found');
    const conn = await this.prisma.sourceConnection.findUniqueOrThrow({
      where: { id: summary.id },
    });
    const credentials = this.sourceConnections.readCredentials(conn);
    const accessToken = String(credentials.accessToken || '');
    const realmId = conn.externalTenantId;
    if (!accessToken)
      throw new BadRequestException(
        'Sage connection credentials require reconnection',
      );

    const invoices = await this.sageProvider.getInvoices(accessToken, realmId);
    const payouts = await this.sageProvider.getPayouts(accessToken, realmId);
    const vendors = await this.sageProvider.getVendors(accessToken, realmId);

    await this.auditLogsService.log({
      userId,
      action: 'INTEGRATION_INVOICES_SYNCED',
      entityType: 'IntegrationConnection',
      details: { provider: 'sage', count: invoices.length },
    });

    return {
      invoices,
      payouts,
      vendors,
      connected: true,
      connectionId: conn.id,
    };
  }

  // ────────────── GENERIC CONNECT / DISCONNECT ──────────────
  async disconnectProvider(userId: string, providerStr: string) {
    const organization =
      await this.sourceConnections.getAgencyOrganization(userId);
    const result = await this.prisma.sourceConnection.updateMany({
      where: {
        organizationId: organization.id,
        connectorKey: providerStr.toLowerCase(),
        deletedAt: null,
      },
      data: { status: 'disconnected' },
    });

    await this.auditLogsService.log({
      userId,
      action: 'INTEGRATION_DISCONNECTED',
      entityType: 'IntegrationConnection',
      details: { provider: providerStr.toLowerCase() },
    });

    return result;
  }
}

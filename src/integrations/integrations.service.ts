import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { IntegrationProvider, IntegrationStatus } from '@prisma/client';
import { QuickBooksProvider } from '../infrastructure/providers/quickbooks/quickbooks.provider';
import { XeroProvider } from '../infrastructure/providers/xero/xero.provider';
import { SageProvider } from '../infrastructure/providers/sage/sage.provider';
import { AuditLogsService } from '../modules/audit-logs/audit-logs.service';

@Injectable()
export class IntegrationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly quickBooksProvider: QuickBooksProvider,
    private readonly xeroProvider: XeroProvider,
    private readonly sageProvider: SageProvider,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  async getStatus(userId: string) {
    const connections = await this.prisma.integrationConnection.findMany({
      where: { userId },
    });
    const qboConnected = connections.some((c) => c.provider === 'quickbooks' && c.status === 'connected');
    const xeroConnected = connections.some((c) => c.provider === 'xero' && c.status === 'connected');
    const sageConnected = connections.some((c) => c.provider === 'sage' && c.status === 'connected');

    return { connections, qboConnected, xeroConnected, sageConnected };
  }

  // ────────────── QUICKBOOKS ──────────────
  async getQuickBooksAuthUrl() {
    const url = await this.quickBooksProvider.getAuthUrl();
    return { url };
  }

  async handleQuickBooksCallback(userId: string, code: string, realmId?: string) {
    const tokens = await this.quickBooksProvider.handleCallback(code, realmId);

    const connection = await this.prisma.integrationConnection.upsert({
      where: { userId_provider: { userId, provider: IntegrationProvider.quickbooks } },
      update: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        realmId,
        expiresAt: tokens.expiresAt,
        status: IntegrationStatus.connected,
        connectedAt: new Date(),
      },
      create: {
        userId,
        provider: IntegrationProvider.quickbooks,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        realmId,
        expiresAt: tokens.expiresAt,
        status: IntegrationStatus.connected,
        connectedAt: new Date(),
      },
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
    const conn = await this.prisma.integrationConnection.findUnique({
      where: { userId_provider: { userId, provider: IntegrationProvider.quickbooks } },
    });

    const accessToken = conn?.accessToken || 'simulated';
    const realmId = conn?.realmId || undefined;

    const invoices = await this.quickBooksProvider.getInvoices(accessToken, realmId);

    await this.auditLogsService.log({
      userId,
      action: 'INTEGRATION_INVOICES_SYNCED',
      entityType: 'IntegrationConnection',
      details: { provider: 'quickbooks', count: invoices.length },
    });

    return { invoices, connected: conn?.status === IntegrationStatus.connected };
  }

  // ────────────── XERO ──────────────
  async getXeroAuthUrl() {
    const url = await this.xeroProvider.getAuthUrl();
    return { url };
  }

  async handleXeroCallback(userId: string, code: string, tenantIdParam?: string) {
    const tokens = await this.xeroProvider.handleCallback(code, tenantIdParam);
    const resolvedTenantId = tokens.tenantId || tenantIdParam;

    const connection = await this.prisma.integrationConnection.upsert({
      where: { userId_provider: { userId, provider: IntegrationProvider.xero } },
      update: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        tenantId: resolvedTenantId,
        institutionName: tokens.tenantName || 'Xero Organization',
        expiresAt: tokens.expiresAt,
        status: IntegrationStatus.connected,
        connectedAt: new Date(),
      },
      create: {
        userId,
        provider: IntegrationProvider.xero,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        tenantId: resolvedTenantId,
        institutionName: tokens.tenantName || 'Xero Organization',
        expiresAt: tokens.expiresAt,
        status: IntegrationStatus.connected,
        connectedAt: new Date(),
      },
    });

    await this.auditLogsService.log({
      userId,
      action: 'INTEGRATION_CONNECTED',
      entityType: 'IntegrationConnection',
      entityId: connection.id,
      details: { provider: 'xero', tenantId: resolvedTenantId, tenantName: tokens.tenantName },
    });

    return { success: true, connection };
  }

  async getXeroInvoices(userId: string) {
    let conn = await this.prisma.integrationConnection.findUnique({
      where: { userId_provider: { userId, provider: IntegrationProvider.xero } },
    });

    let accessToken = conn?.accessToken || 'simulated';
    let tenantId = conn?.tenantId || undefined;

    // Auto-refresh token if expired or close to expiration (within 5 minutes)
    if (
      conn &&
      conn.status === IntegrationStatus.connected &&
      conn.refreshToken &&
      !conn.refreshToken.includes('simulated') &&
      conn.expiresAt &&
      conn.expiresAt.getTime() - Date.now() < 300 * 1000
    ) {
      try {
        const refreshed = await this.xeroProvider.refreshAccessToken(conn.refreshToken);
        conn = await this.prisma.integrationConnection.update({
          where: { id: conn.id },
          data: {
            accessToken: refreshed.accessToken,
            refreshToken: refreshed.refreshToken,
            expiresAt: refreshed.expiresAt,
            status: IntegrationStatus.connected,
          },
        });
        accessToken = conn.accessToken;
      } catch (err: any) {
        await this.prisma.integrationConnection.update({
          where: { id: conn.id },
          data: { status: IntegrationStatus.expired },
        });
      }
    }

    const invoices = await this.xeroProvider.getInvoices(accessToken, tenantId);
    const payouts = await this.xeroProvider.getPayouts(accessToken, tenantId);
    const vendors = await this.xeroProvider.getVendors(accessToken, tenantId);

    await this.auditLogsService.log({
      userId,
      action: 'INTEGRATION_INVOICES_SYNCED',
      entityType: 'IntegrationConnection',
      details: { provider: 'xero', invoiceCount: invoices.length, payoutCount: payouts.length },
    });

    return {
      invoices,
      payouts,
      vendors,
      connected: conn?.status === IntegrationStatus.connected,
      tenantId,
      institutionName: conn?.institutionName || 'Xero Organization',
    };
  }

  // ────────────── SAGE ──────────────
  async getSageAuthUrl() {
    const url = await this.sageProvider.getAuthUrl();
    return { url };
  }

  async handleSageCallback(userId: string, code: string, realmId?: string) {
    const tokens = await this.sageProvider.handleCallback(code, realmId);

    const connection = await this.prisma.integrationConnection.upsert({
      where: { userId_provider: { userId, provider: IntegrationProvider.sage } },
      update: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        realmId,
        expiresAt: tokens.expiresAt,
        status: IntegrationStatus.connected,
        connectedAt: new Date(),
      },
      create: {
        userId,
        provider: IntegrationProvider.sage,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        realmId,
        expiresAt: tokens.expiresAt,
        status: IntegrationStatus.connected,
        connectedAt: new Date(),
      },
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
    const conn = await this.prisma.integrationConnection.findUnique({
      where: { userId_provider: { userId, provider: IntegrationProvider.sage } },
    });

    const accessToken = conn?.accessToken || 'simulated';
    const realmId = conn?.realmId || undefined;

    const invoices = await this.sageProvider.getInvoices(accessToken, realmId);
    const payouts = await this.sageProvider.getPayouts(accessToken, realmId);
    const vendors = await this.sageProvider.getVendors(accessToken, realmId);

    await this.auditLogsService.log({
      userId,
      action: 'INTEGRATION_INVOICES_SYNCED',
      entityType: 'IntegrationConnection',
      details: { provider: 'sage', count: invoices.length },
    });

    return { invoices, payouts, vendors, connected: conn?.status === IntegrationStatus.connected };
  }

  // ────────────── GENERIC CONNECT / DISCONNECT ──────────────
  async connectProvider(userId: string, providerStr: string, itemId?: string) {
    const provider = providerStr.toLowerCase() as IntegrationProvider;
    const conn = await this.prisma.integrationConnection.upsert({
      where: { userId_provider: { userId, provider } },
      update: { status: IntegrationStatus.connected, itemId, connectedAt: new Date() },
      create: { userId, provider, status: IntegrationStatus.connected, itemId, connectedAt: new Date() },
    });

    await this.auditLogsService.log({
      userId,
      action: 'INTEGRATION_CONNECTED',
      entityType: 'IntegrationConnection',
      entityId: conn.id,
      details: { provider },
    });

    return conn;
  }

  async disconnectProvider(userId: string, providerStr: string) {
    const provider = providerStr.toLowerCase() as IntegrationProvider;
    const result = await this.prisma.integrationConnection.updateMany({
      where: { userId, provider },
      data: { status: IntegrationStatus.disconnected },
    });

    await this.auditLogsService.log({
      userId,
      action: 'INTEGRATION_DISCONNECTED',
      entityType: 'IntegrationConnection',
      details: { provider },
    });

    return result;
  }
}

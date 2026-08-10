import { Controller, Get, Post, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { IntegrationsService } from './integrations.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators';

@ApiTags('Integrations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('integrations')
export class IntegrationsController {
  constructor(private readonly integrationsService: IntegrationsService) {}

  @ApiOperation({ summary: 'Get all connected third-party integrations status' })
  @Get('status')
  async getStatus(@CurrentUser('id') userId: string) {
    return this.integrationsService.getStatus(userId);
  }

  // ────────────── QUICKBOOKS ──────────────
  @ApiOperation({ summary: 'Get QuickBooks OAuth authorization URL' })
  @Get('quickbooks/connect')
  async getQuickBooksAuthUrl() {
    return this.integrationsService.getQuickBooksAuthUrl();
  }

  @ApiOperation({ summary: 'QuickBooks OAuth callback handler' })
  @Get('quickbooks/callback')
  async handleQuickBooksCallback(
    @CurrentUser('id') userId: string,
    @Query('code') code: string,
    @Query('realmId') realmId?: string,
  ) {
    return this.integrationsService.handleQuickBooksCallback(userId, code, realmId);
  }

  @ApiOperation({ summary: 'Get read-only imported QuickBooks invoices' })
  @Get('quickbooks/invoices')
  async getQuickBooksInvoices(@CurrentUser('id') userId: string) {
    return this.integrationsService.getQuickBooksInvoices(userId);
  }

  // ────────────── XERO ──────────────
  @ApiOperation({ summary: 'Get Xero OAuth authorization URL' })
  @Get('xero/connect')
  async getXeroAuthUrl() {
    return this.integrationsService.getXeroAuthUrl();
  }

  @ApiOperation({ summary: 'Xero OAuth callback handler' })
  @Get('xero/callback')
  async handleXeroCallback(
    @CurrentUser('id') userId: string,
    @Query('code') code: string,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.integrationsService.handleXeroCallback(userId, code, tenantId);
  }

  @ApiOperation({ summary: 'Get imported Xero invoices' })
  @Get('xero/invoices')
  async getXeroInvoices(@CurrentUser('id') userId: string) {
    return this.integrationsService.getXeroInvoices(userId);
  }

  // ────────────── SAGE ──────────────
  @ApiOperation({ summary: 'Get Sage OAuth authorization URL' })
  @Get('sage/connect')
  async getSageAuthUrl() {
    return this.integrationsService.getSageAuthUrl();
  }

  @ApiOperation({ summary: 'Sage OAuth callback handler' })
  @Get('sage/callback')
  async handleSageCallback(
    @CurrentUser('id') userId: string,
    @Query('code') code: string,
    @Query('realmId') realmId?: string,
  ) {
    return this.integrationsService.handleSageCallback(userId, code, realmId);
  }

  @ApiOperation({ summary: 'Get imported Sage invoices and accounting data' })
  @Get('sage/invoices')
  async getSageInvoices(@CurrentUser('id') userId: string) {
    return this.integrationsService.getSageInvoices(userId);
  }

  // ────────────── GENERIC PROVIDER CONNECT / DISCONNECT ──────────────
  @ApiOperation({ summary: 'Connect provider by name' })
  @Post(':provider/connect')
  async connectProvider(
    @CurrentUser('id') userId: string,
    @Param('provider') provider: string,
    @Body() body: { externalId?: string }
  ) {
    return this.integrationsService.connectProvider(userId, provider, body.externalId);
  }

  @ApiOperation({ summary: 'Disconnect provider' })
  @Delete(':provider/disconnect')
  async disconnectProvider(
    @CurrentUser('id') userId: string,
    @Param('provider') provider: string
  ) {
    return this.integrationsService.disconnectProvider(userId, provider);
  }

  @ApiOperation({ summary: 'Disconnect provider via POST' })
  @Post(':provider/disconnect')
  async disconnectProviderPost(
    @CurrentUser('id') userId: string,
    @Param('provider') provider: string
  ) {
    return this.integrationsService.disconnectProvider(userId, provider);
  }
}

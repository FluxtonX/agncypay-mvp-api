import { Controller, Get, Post, Delete, Body, Param, Query, UseGuards, Res, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { IntegrationsService } from './integrations.service';
import { QuickBooksService } from '../modules/quickbooks/quickbooks.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators';

@ApiTags('Integrations')
@Controller('integrations')
export class IntegrationsController {
  constructor(
    private readonly integrationsService: IntegrationsService,
    private readonly quickbooksService: QuickBooksService,
  ) {}

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get all connected third-party integrations status' })
  @Get('status')
  async getStatus(@CurrentUser('id') userId: string) {
    return this.integrationsService.getStatus(userId);
  }

  // ────────────── QUICKBOOKS ──────────────
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get QuickBooks OAuth authorization URL' })
  @Get('quickbooks/connect')
  async getQuickBooksAuthUrl() {
    return this.integrationsService.getQuickBooksAuthUrl();
  }

  @ApiOperation({ summary: 'QuickBooks OAuth callback handler (browser redirect)' })
  @Get('quickbooks/callback')
  async handleQuickBooksCallback(
    @Query('code') code: string,
    @Query('realmId') realmId: string,
    @Query('state') state: string,
    @Req() req: any,
    @Res() res: any,
  ) {
    try {
      const redirectUrl = await this.quickbooksService.handleCallback(code, realmId, state, req.url);
      return res.redirect(redirectUrl);
    } catch (err: any) {
      return res.redirect(`http://localhost:3000/branddashboard?qb_error=${encodeURIComponent(err.message || 'QuickBooks authorization failed.')}`);
    }
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get read-only imported QuickBooks invoices' })
  @Get('quickbooks/invoices')
  async getQuickBooksInvoices(@CurrentUser('id') userId: string) {
    return this.integrationsService.getQuickBooksInvoices(userId);
  }

  // ────────────── XERO ──────────────
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get Xero OAuth authorization URL' })
  @Get('xero/connect')
  async getXeroAuthUrl() {
    return this.integrationsService.getXeroAuthUrl();
  }

  @ApiOperation({ summary: 'Xero OAuth callback handler' })
  @Get('xero/callback')
  async handleXeroCallback(
    @Query('code') code: string,
    @Query('tenantId') tenantId: string,
    @Res() res: any,
  ) {
    return res.redirect('http://localhost:3000/branddashboard?xero_connected=true');
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get imported Xero invoices' })
  @Get('xero/invoices')
  async getXeroInvoices(@CurrentUser('id') userId: string) {
    return this.integrationsService.getXeroInvoices(userId);
  }

  // ────────────── SAGE ──────────────
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get Sage OAuth authorization URL' })
  @Get('sage/connect')
  async getSageAuthUrl() {
    return this.integrationsService.getSageAuthUrl();
  }

  @ApiOperation({ summary: 'Sage OAuth callback handler' })
  @Get('sage/callback')
  async handleSageCallback(
    @Query('code') code: string,
    @Query('realmId') realmId: string,
    @Res() res: any,
  ) {
    return res.redirect('http://localhost:3000/branddashboard?sage_connected=true');
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get imported Sage invoices and accounting data' })
  @Get('sage/invoices')
  async getSageInvoices(@CurrentUser('id') userId: string) {
    return this.integrationsService.getSageInvoices(userId);
  }

  // ────────────── GENERIC PROVIDER CONNECT / DISCONNECT ──────────────
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Connect provider by name' })
  @Post(':provider/connect')
  async connectProvider(
    @CurrentUser('id') userId: string,
    @Param('provider') provider: string,
    @Body() body: { externalId?: string }
  ) {
    return this.integrationsService.connectProvider(userId, provider, body.externalId);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Disconnect provider' })
  @Delete(':provider/disconnect')
  async disconnectProvider(
    @CurrentUser('id') userId: string,
    @Param('provider') provider: string
  ) {
    return this.integrationsService.disconnectProvider(userId, provider);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Disconnect provider via POST' })
  @Post(':provider/disconnect')
  async disconnectProviderPost(
    @CurrentUser('id') userId: string,
    @Param('provider') provider: string
  ) {
    return this.integrationsService.disconnectProvider(userId, provider);
  }
}

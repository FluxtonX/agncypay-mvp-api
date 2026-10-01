import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  UseGuards,
  Res,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { IntegrationsService } from './integrations.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators';
import { AuthorizationGuard } from '../auth/guards/authorization.guard';
import {
  AccountTypes,
  Permissions,
} from '../auth/decorators/authorization.decorator';
import { ConfigService } from '@nestjs/config';

@ApiTags('Integrations')
@Controller('integrations')
export class IntegrationsController {
  constructor(
    private readonly integrationsService: IntegrationsService,
    private readonly configService: ConfigService,
  ) {}

  private frontendRedirect(returnTo: string, query: string) {
    const frontend =
      this.configService.get<string>('FRONTEND_URL') || 'http://localhost:3000';
    const url = new URL(returnTo, frontend);
    url.search = query;
    return url.toString();
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, AuthorizationGuard)
  @AccountTypes('agency')
  @ApiOperation({
    summary: 'Get all connected third-party integrations status',
  })
  @Get('status')
  async getStatus(@CurrentUser('id') userId: string) {
    return this.integrationsService.getStatus(userId);
  }

  // ────────────── QUICKBOOKS ──────────────
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, AuthorizationGuard)
  @AccountTypes('agency')
  @Permissions('manage_team')
  @ApiOperation({ summary: 'Get QuickBooks OAuth authorization URL' })
  @Get('quickbooks/connect')
  async getQuickBooksAuthUrl(
    @CurrentUser('id') userId: string,
    @Query('returnTo') returnTo?: string,
  ) {
    return this.integrationsService.getQuickBooksAuthUrl(userId, returnTo);
  }

  @ApiOperation({
    summary: 'QuickBooks OAuth callback handler (browser redirect)',
  })
  @Get('quickbooks/callback')
  async handleQuickBooksCallback(
    @Query('code') code: string,
    @Query('realmId') realmId: string,
    @Query('state') state: string,
    @Res() res: any,
  ) {
    try {
      const returnTo =
        await this.integrationsService.completeQuickBooksCallback(
          code,
          realmId,
          state,
        );
      return res.redirect(
        this.frontendRedirect(returnTo, 'quickbooks_connected=true'),
      );
    } catch (err: any) {
      return res.redirect(
        this.frontendRedirect(
          '/agencydashboard/integrations',
          `quickbooks_error=${encodeURIComponent(err.message || 'Authorization failed')}`,
        ),
      );
    }
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, AuthorizationGuard)
  @AccountTypes('agency')
  @ApiOperation({ summary: 'Get read-only imported QuickBooks invoices' })
  @Get('quickbooks/invoices')
  async getQuickBooksInvoices(@CurrentUser('id') userId: string) {
    return this.integrationsService.getQuickBooksInvoices(userId);
  }

  // ────────────── XERO ──────────────
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, AuthorizationGuard)
  @AccountTypes('agency')
  @Permissions('manage_team')
  @ApiOperation({ summary: 'Get Xero OAuth authorization URL' })
  @Get('xero/connect')
  async getXeroAuthUrl(
    @CurrentUser('id') userId: string,
    @Query('returnTo') returnTo?: string,
  ) {
    return this.integrationsService.getXeroAuthUrl(userId, returnTo);
  }

  @ApiOperation({ summary: 'Xero OAuth callback handler' })
  @Get('xero/callback')
  async handleXeroCallback(
    @Query('code') code: string,
    @Query('tenantId') tenantId: string,
    @Query('state') state: string,
    @Res() res: any,
  ) {
    try {
      const returnTo = await this.integrationsService.completeXeroCallback(
        code,
        tenantId,
        state,
      );
      return res.redirect(
        this.frontendRedirect(returnTo, 'xero_connected=true'),
      );
    } catch (err: any) {
      return res.redirect(
        this.frontendRedirect(
          '/agencydashboard/integrations',
          `xero_error=${encodeURIComponent(err.message || 'Authorization failed')}`,
        ),
      );
    }
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, AuthorizationGuard)
  @AccountTypes('agency')
  @ApiOperation({ summary: 'Get imported Xero invoices' })
  @Get('xero/invoices')
  async getXeroInvoices(@CurrentUser('id') userId: string) {
    return this.integrationsService.getXeroInvoices(userId);
  }

  // ────────────── SAGE ──────────────
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, AuthorizationGuard)
  @AccountTypes('agency')
  @Permissions('manage_team')
  @ApiOperation({ summary: 'Get Sage OAuth authorization URL' })
  @Get('sage/connect')
  async getSageAuthUrl(
    @CurrentUser('id') userId: string,
    @Query('returnTo') returnTo?: string,
  ) {
    return this.integrationsService.getSageAuthUrl(userId, returnTo);
  }

  @ApiOperation({ summary: 'Sage OAuth callback handler' })
  @Get('sage/callback')
  async handleSageCallback(
    @Query('code') code: string,
    @Query('realmId') realmId: string,
    @Query('state') state: string,
    @Res() res: any,
  ) {
    try {
      const returnTo = await this.integrationsService.completeSageCallback(
        code,
        realmId,
        state,
      );
      return res.redirect(
        this.frontendRedirect(returnTo, 'sage_connected=true'),
      );
    } catch (err: any) {
      return res.redirect(
        this.frontendRedirect(
          '/agencydashboard/integrations',
          `sage_error=${encodeURIComponent(err.message || 'Authorization failed')}`,
        ),
      );
    }
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, AuthorizationGuard)
  @AccountTypes('agency')
  @ApiOperation({ summary: 'Get imported Sage invoices and accounting data' })
  @Get('sage/invoices')
  async getSageInvoices(@CurrentUser('id') userId: string) {
    return this.integrationsService.getSageInvoices(userId);
  }

  // ────────────── GENERIC PROVIDER DISCONNECT ──────────────
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, AuthorizationGuard)
  @AccountTypes('agency')
  @Permissions('manage_team')
  @ApiOperation({ summary: 'Disconnect provider' })
  @Delete(':provider/disconnect')
  async disconnectProvider(
    @CurrentUser('id') userId: string,
    @Param('provider') provider: string,
  ) {
    return this.integrationsService.disconnectProvider(userId, provider);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, AuthorizationGuard)
  @AccountTypes('agency')
  @Permissions('manage_team')
  @ApiOperation({ summary: 'Disconnect provider via POST' })
  @Post(':provider/disconnect')
  async disconnectProviderPost(
    @CurrentUser('id') userId: string,
    @Param('provider') provider: string,
  ) {
    return this.integrationsService.disconnectProvider(userId, provider);
  }
}

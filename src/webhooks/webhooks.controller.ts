import { Controller, Get, Post, Body, Headers, Req, Query, HttpCode, HttpStatus, UseGuards, ForbiddenException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { CybridWebhookService } from './cybrid-webhook.service';
import { PlaidWebhookService } from './plaid-webhook.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ConfigService } from '@nestjs/config';

@ApiTags('Webhooks')
@Controller('webhooks')
export class WebhooksController {
  constructor(
    private readonly cybridWebhookService: CybridWebhookService,
    private readonly plaidWebhookService: PlaidWebhookService,
    private readonly configService: ConfigService,
  ) {}

  @ApiOperation({ summary: 'Webhook endpoint health check' })
  @ApiResponse({ status: 200, description: 'Webhook service online' })
  @HttpCode(HttpStatus.OK)
  @Get('health')
  async healthCheck() {
    return { status: 'online', service: 'AgncyPay Webhook Listener', plaid: 'active', cybrid: 'active' };
  }

  // ─── CYBRID WEBHOOKS ───────────────────────────────────────────

  @ApiOperation({ summary: 'Cybrid Webhook ingestion endpoint' })
  @ApiResponse({ status: 200, description: 'Webhook processed' })
  @HttpCode(HttpStatus.OK)
  @Post('cybrid')
  async handleCybridWebhook(
    @Req() req: any,
    @Body() payload: any,
    @Headers('x-cybrid-signature') signature?: string,
  ) {
    const rawBody = req?.rawBody ? req.rawBody.toString('utf8') : undefined;
    return this.cybridWebhookService.processWebhookEvent(payload, signature, rawBody);
  }

  @ApiOperation({ summary: 'Simulate Cybrid Webhook for Testing and Development (Sandbox Only, Authenticated)' })
  @ApiResponse({ status: 200, description: 'Simulated event processed' })
  @ApiResponse({ status: 403, description: 'Forbidden in production' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('cybrid/simulate')
  async simulateCybridWebhook(@Body() payload: any) {
    const env = this.configService.get<string>('CYBRID_ENVIRONMENT', 'sandbox');
    if (env === 'production') {
      throw new ForbiddenException('Webhook simulation is disabled in production');
    }
    return this.cybridWebhookService.processWebhookEvent(payload);
  }

  // ─── PLAID WEBHOOKS ────────────────────────────────────────────

  @ApiOperation({ summary: 'Plaid Webhook ingestion endpoint (Bank Updates, Auth, Balances)' })
  @ApiResponse({ status: 200, description: 'Plaid webhook processed' })
  @HttpCode(HttpStatus.OK)
  @Post('plaid')
  async handlePlaidWebhook(
    @Body() payload: any,
    @Headers('plaid-verification') verificationHeader?: string,
  ) {
    return this.plaidWebhookService.processWebhook(payload, verificationHeader);
  }

  @ApiOperation({ summary: 'Simulate or fire a Plaid Webhook event (Sandbox Testing)' })
  @ApiResponse({ status: 200, description: 'Simulated Plaid event processed' })
  @HttpCode(HttpStatus.OK)
  @Post('plaid/simulate')
  async simulatePlaidWebhook(
    @Body()
    body: {
      webhook_type?: string;
      webhook_code?: string;
      item_id?: string;
      error?: any;
      new_transactions?: number;
    },
  ) {
    const payload = {
      webhook_type: body.webhook_type || 'ITEM',
      webhook_code: body.webhook_code || 'DEFAULT_UPDATE',
      item_id: body.item_id || 'sandbox_item_simulated',
      error: body.error || null,
      new_transactions: body.new_transactions ?? 5,
    };
    return this.plaidWebhookService.processWebhook(payload);
  }

  @ApiOperation({ summary: 'Get list of recent Plaid webhook events received' })
  @ApiResponse({ status: 200, description: 'List of Plaid webhook events' })
  @Get('plaid/events')
  async getPlaidWebhookEvents(@Query('limit') limit?: string) {
    const parsedLimit = limit ? parseInt(limit, 10) : 25;
    return this.plaidWebhookService.getRecentEvents(parsedLimit);
  }
}

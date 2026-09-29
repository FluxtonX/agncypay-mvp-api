import { Controller, Get, Post, Body, Headers, Query, Req, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { PlaidWebhookService } from './plaid-webhook.service';
import { ConduitWebhookService } from './conduit-webhook.service';

@ApiTags('Webhooks')
@Controller('webhooks')
export class WebhooksController {
  constructor(
    private readonly plaidWebhookService: PlaidWebhookService,
    private readonly conduitWebhookService: ConduitWebhookService,
  ) {}

  @ApiOperation({ summary: 'Webhook endpoint health check' })
  @ApiResponse({ status: 200, description: 'Webhook service online' })
  @HttpCode(HttpStatus.OK)
  @Get('health')
  async healthCheck() {
    return { status: 'online', service: 'AgncyPay Webhook Listener', plaid: 'active' };
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

  @ApiOperation({ summary: 'Conduit Financial live webhook handler' })
  @ApiResponse({ status: 200, description: 'Conduit webhook processed' })
  @Post('conduit')
  async handleConduitWebhook(
    @Headers('x-conduit-signature') signature: string,
    @Body() body: any,
    @Req() req: any,
  ) {
    return this.conduitWebhookService.processWebhook(signature, body, req.rawBody);
  }
}

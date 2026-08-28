import { Controller, Get, Post, Body, Headers, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { CybridWebhookService } from './cybrid-webhook.service';

@ApiTags('Webhooks')
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly cybridWebhookService: CybridWebhookService) {}

  @ApiOperation({ summary: 'Webhook endpoint health check' })
  @ApiResponse({ status: 200, description: 'Webhook service online' })
  @HttpCode(HttpStatus.OK)
  @Get('health')
  async healthCheck() {
    return { status: 'online', service: 'AgncyPay Webhook Listener' };
  }

  @ApiOperation({ summary: 'Cybrid Webhook ingestion endpoint' })
  @ApiResponse({ status: 200, description: 'Webhook processed' })
  @HttpCode(HttpStatus.OK)
  @Post('cybrid')
  async handleCybridWebhook(
    @Body() payload: any,
    @Headers('x-cybrid-signature') signature?: string,
  ) {
    return this.cybridWebhookService.processWebhookEvent(payload, signature);
  }

  @ApiOperation({ summary: 'Simulate Cybrid Webhook for Testing and Development' })
  @ApiResponse({ status: 200, description: 'Simulated event processed' })
  @HttpCode(HttpStatus.OK)
  @Post('cybrid/simulate')
  async simulateCybridWebhook(@Body() payload: any) {
    return this.cybridWebhookService.processWebhookEvent(payload);
  }
}


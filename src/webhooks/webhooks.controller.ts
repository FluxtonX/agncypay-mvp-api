import { Controller, Get, Post, Body, Headers, HttpCode, HttpStatus, UseGuards, ForbiddenException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { CybridWebhookService } from './cybrid-webhook.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ConfigService } from '@nestjs/config';

@ApiTags('Webhooks')
@Controller('webhooks')
export class WebhooksController {
  constructor(
    private readonly cybridWebhookService: CybridWebhookService,
    private readonly configService: ConfigService,
  ) {}

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
}

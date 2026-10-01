import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { ConduitWebhookService } from './conduit-webhook.service';

@ApiTags('Webhooks')
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly conduitWebhookService: ConduitWebhookService) {}

  @ApiOperation({ summary: 'Webhook endpoint health check' })
  @ApiResponse({ status: 200, description: 'Webhook service online' })
  @HttpCode(HttpStatus.OK)
  @Get('health')
  healthCheck() {
    return { status: 'online', service: 'AgncyPay Webhook Listener' };
  }

  @ApiOperation({
    summary: 'Conduit webhook handler behind PaymentProvider synchronization',
  })
  @ApiResponse({ status: 200, description: 'Conduit webhook processed' })
  @Post('conduit')
  handleConduitWebhook(
    @Headers('conduit-signature') officialSignature: string,
    @Headers('conduit-signature-timestamp') timestamp: string,
    @Headers('x-conduit-signature') legacySignature: string,
    @Headers('x-webhook-id') eventId: string,
    @Body() body: Record<string, unknown>,
    @Req() request: RawBodyRequest<Request>,
  ) {
    return this.conduitWebhookService.processWebhook({
      signature: officialSignature || legacySignature,
      timestamp,
      eventId,
      payload: body,
      rawBody: request.rawBody,
    });
  }
}

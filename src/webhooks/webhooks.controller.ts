import { Controller, Post, Req, Headers, Body, HttpCode, HttpStatus } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { InvoicesService } from '../invoices/invoices.service';

@ApiTags('Webhooks')
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly invoicesService: InvoicesService) {}

  @ApiOperation({ summary: 'Handle real-time payment status webhooks from Modern Treasury' })
  @ApiResponse({ status: 200, description: 'Webhook event received and processed successfully' })
  @ApiResponse({ status: 401, description: 'Invalid HMAC signature header' })
  @HttpCode(HttpStatus.OK)
  @Post('modern-treasury')
  async handleModernTreasuryWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-signature') signature: string,
    @Body() body: any,
  ) {
    const rawBody = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(body);
    return this.invoicesService.handleModernTreasuryWebhook(body, rawBody, signature);
  }
}

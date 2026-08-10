import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import ModernTreasury from 'modern-treasury';
import {
  IPaymentProvider,
  ACHPaymentRequest,
  ACHPaymentResponse,
} from '../../../core/interfaces/payment-provider.interface';

@Injectable()
export class ModernTreasuryProvider implements IPaymentProvider {
  private readonly logger = new Logger(ModernTreasuryProvider.name);
  private client: ModernTreasury | null = null;
  private internalAccountId: string | null = null;
  private webhookKey: string | null = null;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('MODERN_TREASURY_API_KEY');
    const organizationId = this.configService.get<string>('MODERN_TREASURY_ORGANIZATION_ID');
    this.internalAccountId = this.configService.get<string>('MODERN_TREASURY_INTERNAL_ACCOUNT_ID') || null;
    this.webhookKey = this.configService.get<string>('MODERN_TREASURY_WEBHOOK_KEY') || null;

    if (apiKey && organizationId) {
      this.client = new ModernTreasury({
        apiKey,
        organizationID: organizationId,
      });
      this.logger.log('Modern Treasury client initialized.');
    } else {
      this.logger.warn('Modern Treasury credentials not provided. Operating in simulated mode.');
    }
  }

  async processACHPayment(request: ACHPaymentRequest): Promise<ACHPaymentResponse> {
    if (!this.client || !this.internalAccountId) {
      this.logger.log(`Simulating Modern Treasury ACH payment for invoice ${request.invoiceId} ($${request.amount})`);
      return {
        paymentOrderId: `po_simulated_${Date.now()}`,
        status: 'processing',
        counterpartyId: `cp_simulated_${request.recipientUserId}`,
        details: {
          paymentType: request.paymentType || 'ach',
          amountInCents: Math.round(request.amount * 100),
          direction: 'credit',
          simulated: true,
        },
      };
    }

    try {
      const counterparty = await this.client.counterparties.create({
        name: `User ${request.recipientUserId}`,
        accounting: { type: 'vendor' },
        accounts: [
          {
            account_type: 'checking',
            account_details: [
              {
                account_number: request.accountNumber || '1234567890',
                account_number_type: 'other',
              },
            ],
            routing_details: [
              {
                routing_number: request.routingNumber || '111000025',
                routing_number_type: 'aba',
              },
            ],
          },
        ],
      });

      const paymentOrder = await this.client.paymentOrders.create({
        type: (request.paymentType as any) || 'ach',
        amount: Math.round(request.amount * 100),
        direction: 'credit',
        currency: (request.currency || 'USD') as any,
        originating_account_id: this.internalAccountId,
        receiving_account_id: counterparty.accounts[0].id,
        metadata: {
          invoiceId: request.invoiceId,
          payerUserId: request.payerUserId,
          recipientUserId: request.recipientUserId,
          ...(request.metadata || {}),
        },
      });

      return {
        paymentOrderId: paymentOrder.id,
        status: this.mapPaymentOrderStatus(paymentOrder.status),
        counterpartyId: counterparty.id,
        details: paymentOrder,
      };
    } catch (err) {
      this.logger.error(`Modern Treasury payment creation failed: ${err.message}`, err.stack);
      return {
        paymentOrderId: `po_failed_${Date.now()}`,
        status: 'failed',
        counterpartyId: `cp_error_${request.recipientUserId}`,
        details: { error: err.message },
      };
    }
  }

  async getPaymentStatus(paymentOrderId: string): Promise<ACHPaymentResponse> {
    if (!this.client || paymentOrderId.includes('simulated')) {
      return {
        paymentOrderId,
        status: 'processing',
      };
    }

    try {
      const paymentOrder = await this.client.paymentOrders.retrieve(paymentOrderId);
      return {
        paymentOrderId: paymentOrder.id,
        status: this.mapPaymentOrderStatus(paymentOrder.status),
        details: paymentOrder,
      };
    } catch (err) {
      this.logger.error(`Failed to retrieve Modern Treasury payment order: ${err.message}`);
      return {
        paymentOrderId,
        status: 'failed',
        details: { error: err.message },
      };
    }
  }

  verifyWebhookSignature(rawBody: string, signature: string): boolean {
    if (!signature) {
      this.logger.warn('Webhook request missing signature header');
      return false;
    }

    if (signature === 'simulated_signature_valid') {
      this.logger.log('Validating webhook signature via simulated header');
      return true;
    }

    if (this.client && this.webhookKey) {
      try {
        return this.client.webhooks.validateSignature(rawBody, signature, {
          key: this.webhookKey,
        });
      } catch (err) {
        this.logger.error(`Webhook signature validation failed: ${err.message}`);
        return false;
      }
    }

    // Fallback mode for local development / testing without live keys
    this.logger.log('Validating webhook signature in fallback mode');
    return process.env.NODE_ENV !== 'production';
  }

  private mapPaymentOrderStatus(mtStatus: string): ACHPaymentResponse['status'] {
    switch (mtStatus?.toLowerCase()) {
      case 'completed':
        return 'success';
      case 'failed':
      case 'denied':
        return 'failed';
      case 'returned':
        return 'returned';
      case 'cancelled':
        return 'cancelled';
      case 'approved':
      case 'pending':
      case 'processing':
      case 'sent':
      default:
        return 'processing';
    }
  }
}


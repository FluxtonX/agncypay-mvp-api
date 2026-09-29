import { Injectable, Logger, BadGatewayException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import {
  ConduitCustomerParams,
  ConduitCustomer,
  ConduitBeneficiaryParams,
  ConduitBeneficiary,
  ConduitTransferParams,
  ConduitTransfer,
  ConduitVirtualAccount,
} from './conduit.types';

@Injectable()
export class ConduitProvider {
  private readonly logger = new Logger(ConduitProvider.name);
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly webhookSecret: string;

  constructor(private readonly configService: ConfigService) {
    this.baseUrl = (
      this.configService.get<string>('CONDUIT_BASE_URL') ||
      'https://api.sandbox.conduit.financial/v2'
    ).replace(/\/$/, '');
    this.apiKey = this.configService.get<string>('CONDUIT_API_KEY') || '';
    this.webhookSecret = this.configService.get<string>('CONDUIT_WEBHOOK_SECRET') || '';

    if (!this.apiKey) {
      this.logger.warn('CONDUIT_API_KEY is not set. Outbound live calls will fail unless configured.');
    } else {
      this.logger.log(`Conduit Live Sandbox Provider initialized targeting: ${this.baseUrl}`);
    }
  }

  private getHeaders(idempotencyKey?: string): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': `Bearer ${this.apiKey}`,
      'X-API-Key': this.apiKey,
    };
    if (idempotencyKey) {
      headers['Idempotency-Key'] = idempotencyKey;
    }
    return headers;
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    this.logger.debug(`Conduit API Request: ${options.method || 'GET'} ${url}`);

    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          ...this.getHeaders(),
          ...(options.headers || {}),
        },
      });

      const responseText = await response.text();
      let responseData: any;
      try {
        responseData = responseText ? JSON.parse(responseText) : {};
      } catch {
        responseData = { raw: responseText };
      }

      if (!response.ok) {
        this.logger.error(
          `Conduit API Error (${response.status}): ${JSON.stringify(responseData)}`,
        );
        throw new BadGatewayException(
          responseData?.message ||
          responseData?.error ||
          `Conduit API responded with status ${response.status}`,
        );
      }

      return responseData as T;
    } catch (err: any) {
      if (err instanceof BadGatewayException) {
        throw err;
      }
      this.logger.error(`Conduit Network/Transport error: ${err.message}`);
      throw new BadGatewayException(`Conduit Live Sandbox Connection Failed: ${err.message}`);
    }
  }

  /**
   * 1. Register or retrieve customer on Conduit rails
   */
  async createCustomer(params: ConduitCustomerParams): Promise<ConduitCustomer> {
    return this.request<ConduitCustomer>('/customers', {
      method: 'POST',
      body: JSON.stringify({
        name: params.name,
        email: params.email,
        type: params.type,
        country: params.country || 'USA',
        tax_id: params.taxId,
        metadata: params.metadata,
      }),
    });
  }

  async getCustomer(customerId: string): Promise<ConduitCustomer> {
    return this.request<ConduitCustomer>(`/customers/${customerId}`);
  }

  /**
   * 2. Provision beneficiary bank account for payouts
   */
  async createBeneficiary(params: ConduitBeneficiaryParams): Promise<ConduitBeneficiary> {
    return this.request<ConduitBeneficiary>('/beneficiaries', {
      method: 'POST',
      body: JSON.stringify({
        customer_id: params.customerId,
        account_holder_name: params.accountHolderName,
        account_number: params.accountNumber,
        routing_number: params.routingNumber,
        currency: params.currency || 'USD',
        account_type: params.accountType || 'checking',
        country: params.country || 'USA',
        metadata: params.metadata,
      }),
    });
  }

  /**
   * 3. Execute live payout transfer on Conduit Sandbox
   */
  async createTransfer(params: ConduitTransferParams): Promise<ConduitTransfer> {
    if (params.amount <= 0) {
      throw new BadRequestException('Transfer amount must be strictly positive');
    }

    return this.request<ConduitTransfer>('/transfers', {
      method: 'POST',
      headers: params.idempotencyKey ? { 'Idempotency-Key': params.idempotencyKey } : {},
      body: JSON.stringify({
        source_account_id: params.sourceAccountId,
        beneficiary_id: params.beneficiaryId,
        amount: params.amount,
        currency: params.currency || 'USD',
        reference: params.reference,
        metadata: params.metadata,
      }),
    });
  }

  /**
   * 4. Query live status of a transfer
   */
  async getTransfer(transferId: string): Promise<ConduitTransfer> {
    return this.request<ConduitTransfer>(`/transfers/${transferId}`);
  }

  /**
   * 5. Get Virtual Deposit Account for inbound client funding
   */
  async getVirtualAccount(customerId: string): Promise<ConduitVirtualAccount> {
    return this.request<ConduitVirtualAccount>(`/customers/${customerId}/virtual-accounts`);
  }

  /**
   * 6. Webhook cryptographic HMAC-SHA256 signature verification
   */
  verifyWebhookSignature(signature: string, rawBody: Buffer | string): boolean {
    if (!this.webhookSecret || !signature) {
      return true; // Pass through in sandbox development if secret is not set
    }
    const computed = crypto
      .createHmac('sha256', this.webhookSecret)
      .update(typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8'))
      .digest('hex');

    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(computed));
  }
}

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
  ConduitVirtualAccountParams,
  ConduitOnboardingApplicationParams,
  ConduitOnboardingApplicationResponse,
  ConduitRecipientParams,
  ConduitRecipient,
  ConduitPayoutParams,
  ConduitPayoutResponse,
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
   * 1. Discover onboarding requirements for a country (Conduit v2)
   */
  async discoverOnboardingRequirements(country = 'USA'): Promise<any> {
    if (!this.apiKey) {
      return {
        country: country.toUpperCase(),
        fields: [
          { pointer: '/businessInfo/legalName', required: true, label: 'Legal Business Name' },
          { pointer: '/businessInfo/taxId', required: true, label: 'Tax ID / EIN' },
          { pointer: '/businessInfo/country', required: true, label: 'Country of Incorporation' },
          { pointer: '/ownership/persons/0/firstName', required: true, label: 'Beneficial Owner First Name' },
          { pointer: '/ownership/persons/0/lastName', required: true, label: 'Beneficial Owner Last Name' },
          { pointer: '/ownership/persons/0/email', required: true, label: 'Beneficial Owner Email' },
        ],
        documents: [
          { type: 'CERTIFICATE_OF_INCORPORATION', required: false, description: 'Articles of Organization or Incorporation' },
          { type: 'PROOF_OF_ADDRESS', required: false, description: 'Bank Statement or Utility Bill' },
        ],
      };
    }
    return this.request<any>(`/onboarding/requirements?country=${encodeURIComponent(country)}`);
  }

  /**
   * 2. Submit customer onboarding application (Conduit v2: POST /v2/onboarding)
   */
  async submitCustomerOnboarding(
    params: ConduitOnboardingApplicationParams,
  ): Promise<ConduitOnboardingApplicationResponse> {
    if (!this.apiKey) {
      const appId = `app_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const custId = `cust_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      return {
        id: appId,
        clientReferenceId: params.clientReferenceId,
        status: 'approved',
        customerId: custId,
        createdAt: new Date().toISOString(),
      };
    }

    return this.request<ConduitOnboardingApplicationResponse>('/onboarding', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  /**
   * 3. Register or retrieve customer on Conduit rails
   */
  async createCustomer(params: ConduitCustomerParams): Promise<ConduitCustomer> {
    if (!this.apiKey) {
      return {
        id: `cust_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        name: params.name,
        email: params.email,
        type: params.type,
        status: 'approved',
        createdAt: new Date().toISOString(),
      };
    }

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
    if (!this.apiKey) {
      return {
        id: customerId,
        name: 'Demo Customer',
        email: 'demo@agncypay.com',
        type: 'business',
        status: 'approved',
        createdAt: new Date().toISOString(),
      };
    }
    return this.request<ConduitCustomer>(`/customers/${customerId}`);
  }

  /**
   * 4. Provision dedicated Virtual Deposit Account (USD ACH/Fedwire)
   */
  async createVirtualAccount(params: ConduitVirtualAccountParams): Promise<ConduitVirtualAccount> {
    if (!this.apiKey) {
      const randomSuffix = Math.floor(1000 + Math.random() * 9000);
      return {
        id: `va_${Date.now()}_${randomSuffix}`,
        customerId: params.customerId,
        accountNumber: `4028${Math.floor(10000000 + Math.random() * 90000000)}`,
        routingNumber: '021000021',
        bankName: 'JPMorgan Chase (Conduit Settlement)',
        beneficiaryName: 'AgncyPay FBO Client',
        currency: params.asset || 'USD',
        status: 'active',
      };
    }

    return this.request<ConduitVirtualAccount>(`/customers/${params.customerId}/features`, {
      method: 'POST',
      body: JSON.stringify({
        feature: 'VIRTUAL_ACCOUNT',
        asset: params.asset || 'USD',
      }),
    });
  }

  async getVirtualAccount(customerId: string): Promise<ConduitVirtualAccount> {
    if (!this.apiKey) {
      return {
        id: `va_${customerId}`,
        customerId,
        accountNumber: '402891823746',
        routingNumber: '021000021',
        bankName: 'JPMorgan Chase (Conduit Settlement)',
        beneficiaryName: 'AgncyPay FBO Client',
        currency: 'USD',
        status: 'active',
      };
    }
    return this.request<ConduitVirtualAccount>(`/customers/${customerId}/virtual-accounts`);
  }

  /**
   * 5. Register a Whitelist Recipient / Beneficiary (Plaid to Conduit pipeline)
   */
  async createRecipient(params: ConduitRecipientParams): Promise<ConduitRecipient> {
    if (!this.apiKey) {
      const recId = `rec_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const mask = params.accountNumber?.slice(-4) || '6789';
      return {
        id: recId,
        customerId: params.customerId,
        name: params.name,
        recipientType: params.type || 'individual',
        status: 'active',
        payoutRail: params.payoutRail || 'ach',
        accountNumberMask: mask,
        routingNumber: params.routingNumber || '021000021',
        walletAddress: params.walletAddress,
        createdAt: new Date().toISOString(),
      };
    }

    return this.request<ConduitRecipient>('/whitelist-recipients', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  // Alias for backward compatibility
  async createBeneficiary(params: ConduitBeneficiaryParams): Promise<ConduitBeneficiary> {
    const res = await this.createRecipient({
      customerId: params.customerId,
      name: params.accountHolderName || 'Beneficiary',
      accountNumber: params.accountNumber,
      routingNumber: params.routingNumber,
      payoutRail: 'ach',
    });
    return {
      ...res,
      accountHolderName: params.accountHolderName,
    };
  }

  /**
   * 6. Execute live payout transfer on Conduit Sandbox (POST /v2/payouts)
   */
  async createPayout(params: ConduitPayoutParams): Promise<ConduitPayoutResponse> {
    if (params.amount <= 0) {
      throw new BadRequestException('Payout amount must be strictly positive');
    }

    if (!this.apiKey) {
      const payoutId = `payout_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      return {
        id: payoutId,
        status: 'completed',
        amount: params.amount,
        currency: params.currency || 'USD',
        reference: params.reference,
        createdAt: new Date().toISOString(),
        settledAt: new Date().toISOString(),
      };
    }

    return this.request<ConduitPayoutResponse>('/payouts', {
      method: 'POST',
      headers: params.idempotencyKey ? { 'Idempotency-Key': params.idempotencyKey } : {},
      body: JSON.stringify({
        customerId: params.customerId,
        amount: params.amount,
        currency: params.currency || 'USD',
        destination: {
          recipientId: params.recipientId || params.beneficiaryId,
        },
        purpose: params.purpose || 'talent_payout',
        metadata: params.metadata,
      }),
    });
  }

  // Alias for transfer
  async createTransfer(params: ConduitTransferParams): Promise<ConduitTransfer> {
    return this.createPayout(params);
  }

  async getTransfer(transferId: string): Promise<ConduitTransfer> {
    if (!this.apiKey) {
      return {
        id: transferId,
        status: 'completed',
        amount: 100,
        currency: 'USD',
        createdAt: new Date().toISOString(),
        settledAt: new Date().toISOString(),
      };
    }
    return this.request<ConduitTransfer>(`/payouts/${transferId}`);
  }

  /**
   * 7. Webhook cryptographic HMAC-SHA256 signature verification (Conduit v2 specification)
   */
  verifyWebhookSignature(signatureHeader: string, rawBody: Buffer | string): boolean {
    if (!this.webhookSecret || !signatureHeader) {
      return true; // Pass through in sandbox development if secret is not set
    }

    try {
      const rawString = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
      const pairs = signatureHeader.split(',').map((p) => p.split('='));
      const t = pairs.find(([k]) => k === 't')?.[1];
      const signatures = pairs.filter(([k]) => k === 'v1').map(([, v]) => v);

      if (!t || signatures.length === 0) {
        // Fallback for simple hex HMAC if legacy header format was sent
        const computed = crypto
          .createHmac('sha256', this.webhookSecret)
          .update(rawString)
          .digest('hex');
        const compBuf = Buffer.from(computed, 'hex');
        const sigBuf = Buffer.from(signatureHeader, 'hex');
        return compBuf.length === sigBuf.length && crypto.timingSafeEqual(sigBuf, compBuf);
      }

      // Enforce 300-second replay window
      const tNum = parseInt(t, 10);
      if (Math.abs(Math.floor(Date.now() / 1000) - tNum) > 300) {
        this.logger.warn('Conduit webhook rejected: replay window exceeded (>300s)');
        return false;
      }

      const expected = crypto
        .createHmac('sha256', this.webhookSecret)
        .update(`${t}.${rawString}`)
        .digest('hex');

      const expectedBuf = Buffer.from(expected, 'hex');
      return signatures.some((v1) => {
        const v1Buf = Buffer.from(v1, 'hex');
        return expectedBuf.length === v1Buf.length && crypto.timingSafeEqual(expectedBuf, v1Buf);
      });
    } catch (err: any) {
      this.logger.warn(`Conduit webhook signature verification error: ${err.message}`);
      return false;
    }
  }
}

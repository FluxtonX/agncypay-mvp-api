import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import {
  PaymentProvider,
  ProviderDepositAccountRequest,
  ProviderDepositAccountResult,
  ProviderOnboardingRequest,
  ProviderOnboardingResult,
  ProviderRecipientRequest,
  ProviderRecipientResult,
  ProviderTransferRequest,
  ProviderTransferResult,
  ProviderFxQuoteRequest,
  ProviderFxQuoteResult,
  ProviderFxConversionRequest,
  ProviderFxConversionResult,
} from '../../../core/interfaces/payment-provider.interface';

@Injectable()
export class FakePaymentProvider implements PaymentProvider {
  readonly name = 'fake';

  isConfigured(): boolean {
    return true;
  }

  async discoverOnboardingRequirements(country: string) {
    return { country, fields: [], documents: [] };
  }

  async submitOnboarding(
    params: ProviderOnboardingRequest,
  ): Promise<ProviderOnboardingResult> {
    return {
      id: `fake-onboarding-${crypto.randomUUID()}`,
      clientReferenceId: params.clientReferenceId,
      customerId: `fake-party-${crypto.randomUUID()}`,
      status: 'approved',
      createdAt: new Date().toISOString(),
    };
  }

  async createDepositAccount(
    params: ProviderDepositAccountRequest,
  ): Promise<ProviderDepositAccountResult> {
    return {
      id: `fake-deposit-${crypto.randomUUID()}`,
      partyId: params.partyId,
      currency: params.currency || 'USD',
      status: 'active',
      accountNumber: '0000000000',
      routingNumber: '000000000',
      bankName: 'Fake Payment Provider',
    };
  }

  async createRecipient(
    params: ProviderRecipientRequest,
  ): Promise<ProviderRecipientResult> {
    return {
      id: `fake-recipient-${crypto.randomUUID()}`,
      partyId: params.partyId,
      name: params.name,
      status: 'active',
      payoutRail: params.payoutRail || 'ach',
      accountNumberMask: params.accountNumber?.slice(-4),
      createdAt: new Date().toISOString(),
    };
  }

  async createTransfer(
    params: ProviderTransferRequest,
  ): Promise<ProviderTransferResult> {
    return {
      id: `fake-transfer-${crypto.randomUUID()}`,
      status: 'completed',
      amount: params.amount,
      currency: params.currency,
      reference: params.reference,
      createdAt: new Date().toISOString(),
      settledAt: new Date().toISOString(),
    };
  }

  async getTransfer(transferId: string): Promise<ProviderTransferResult> {
    return {
      id: transferId,
      status: 'completed',
      amount: 0,
      currency: 'USD',
      createdAt: new Date().toISOString(),
    };
  }

  async createFxQuote(
    params: ProviderFxQuoteRequest,
  ): Promise<ProviderFxQuoteResult> {
    const rate = params.sourceCurrency === params.destinationCurrency ? 1 : 0.9;
    return {
      id: `fake-quote-${crypto.randomUUID()}`,
      sourceCurrency: params.sourceCurrency,
      destinationCurrency: params.destinationCurrency,
      sourceAmount: params.sourceAmount,
      destinationAmount: Number((params.sourceAmount * rate).toFixed(4)),
      exchangeRate: rate,
      feeAmount: 0,
      feeCurrency: params.sourceCurrency,
      expiresAt: new Date(Date.now() + 3 * 60 * 1000).toISOString(),
    };
  }

  async executeFxConversion(
    params: ProviderFxConversionRequest,
  ): Promise<ProviderFxConversionResult> {
    return {
      id: `fake-conversion-${crypto.randomUUID()}`,
      status: 'completed',
      sourceCurrency: 'USD',
      destinationCurrency: 'EUR',
      sourceAmount: 0,
      destinationAmount: 0,
      raw: { quoteId: params.quoteId },
    };
  }

  async getFxConversion(
    conversionId: string,
  ): Promise<ProviderFxConversionResult> {
    return {
      id: conversionId,
      status: 'completed',
      sourceCurrency: 'USD',
      destinationCurrency: 'EUR',
      sourceAmount: 0,
      destinationAmount: 0,
    };
  }

  verifyWebhookSignature(): boolean {
    return true;
  }
}

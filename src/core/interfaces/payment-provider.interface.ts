export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');

export type ProviderState =
  'pending' | 'processing' | 'completed' | 'failed' | 'returned' | 'cancelled';

export interface ProviderOnboardingRequest {
  clientReferenceId: string;
  customerType?: string;
  businessInfo?: Record<string, unknown>;
  ownership?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ProviderOnboardingResult {
  id: string;
  clientReferenceId?: string;
  status: string;
  customerId?: string;
  createdAt?: string;
  [key: string]: unknown;
}

export interface ProviderDepositAccountRequest {
  partyId: string;
  currency?: string;
  accountType?: string;
  idempotencyKey?: string;
  metadata?: Record<string, unknown>;
}

export interface ProviderDepositAccountResult {
  id: string;
  partyId: string;
  currency: string;
  status: string;
  accountNumber?: string;
  routingNumber?: string;
  bankName?: string;
  beneficiaryName?: string;
  [key: string]: unknown;
}

export interface ProviderRecipientRequest {
  partyId: string;
  name: string;
  type?: 'individual' | 'business';
  accountNumber?: string;
  routingNumber?: string;
  payoutRail?: string;
  walletAddress?: string;
  providerAccountToken?: string;
  metadata?: Record<string, unknown>;
}

export interface ProviderRecipientResult {
  id: string;
  partyId: string;
  name: string;
  status: string;
  payoutRail?: string;
  accountNumberMask?: string;
  routingNumber?: string;
  walletAddress?: string;
  createdAt?: string;
  [key: string]: unknown;
}

export interface ProviderTransferRequest {
  transferId?: string;
  partyId: string;
  recipientId?: string;
  amount: number;
  currency: string;
  purpose?: string;
  reference?: string;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
}

export interface ProviderTransferResult {
  id: string;
  status: ProviderState;
  amount: number;
  currency: string;
  reference?: string;
  failureCode?: string;
  createdAt?: string;
  settledAt?: string;
  [key: string]: unknown;
}

export interface ProviderFxQuoteRequest {
  sourceCurrency: string;
  destinationCurrency: string;
  sourceAmount: number;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
}

export interface ProviderFxQuoteResult {
  id: string;
  sourceCurrency: string;
  destinationCurrency: string;
  sourceAmount: number;
  destinationAmount: number;
  exchangeRate: number;
  feeAmount: number;
  feeCurrency: string;
  expiresAt: string;
  raw?: Record<string, unknown>;
}

export interface ProviderFxConversionRequest {
  quoteId: string;
  sourceAccountId: string;
  destinationAccountId: string;
  idempotencyKey: string;
  reference?: string;
  purpose?: string;
  metadata?: Record<string, unknown>;
}

export interface ProviderFxConversionResult {
  id: string;
  status: ProviderState;
  sourceCurrency: string;
  destinationCurrency: string;
  sourceAmount: number;
  destinationAmount: number;
  failureCode?: string;
  raw?: Record<string, unknown>;
}

export interface PaymentProvider {
  readonly name: string;
  isConfigured(): boolean;
  discoverOnboardingRequirements(country: string): Promise<unknown>;
  submitOnboarding(
    params: ProviderOnboardingRequest,
  ): Promise<ProviderOnboardingResult>;
  createDepositAccount(
    params: ProviderDepositAccountRequest,
  ): Promise<ProviderDepositAccountResult>;
  createRecipient(
    params: ProviderRecipientRequest,
  ): Promise<ProviderRecipientResult>;
  createTransfer(
    params: ProviderTransferRequest,
  ): Promise<ProviderTransferResult>;
  getTransfer(transferId: string): Promise<ProviderTransferResult>;
  createFxQuote(params: ProviderFxQuoteRequest): Promise<ProviderFxQuoteResult>;
  executeFxConversion(
    params: ProviderFxConversionRequest,
  ): Promise<ProviderFxConversionResult>;
  getFxConversion(conversionId: string): Promise<ProviderFxConversionResult>;
  verifyWebhookSignature(
    signature: string,
    rawBody: Buffer | string,
    timestamp?: string,
  ): boolean;
}

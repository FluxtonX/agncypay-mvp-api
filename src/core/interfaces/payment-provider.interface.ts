export interface ACHPaymentRequest {
  invoiceId: string;
  amount: number;
  currency: string;
  payerUserId: string;
  recipientUserId: string;
  originatingAccountId?: string;
  receivingAccountId?: string;
  accountNumber?: string;
  routingNumber?: string;
  paymentType?: 'ach' | 'wire' | 'rtp';
  metadata?: Record<string, any>;
}

export interface ACHPaymentResponse {
  paymentOrderId: string;
  status: 'pending' | 'processing' | 'success' | 'failed' | 'returned' | 'cancelled';
  counterpartyId?: string;
  details?: Record<string, any>;
}

export interface LegalEntityParams {
  agencyId: string;
  legalName: string;
  businessType?: string;
  registrationNumber?: string;
  taxId?: string;
  address?: {
    line1?: string;
    line2?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    country?: string;
  };
}

export interface CounterpartyParams {
  name: string;
  email?: string;
  partyType?: 'business' | 'individual';
  metadata?: Record<string, any>;
}

export interface ExternalAccountParams {
  counterpartyId: string;
  name: string;
  accountNumber: string;
  routingNumber: string;
  accountType?: 'checking' | 'savings';
}

export interface InternalAccountParams {
  name: string;
  legalEntityId?: string;
  currency?: string;
}

export interface LedgerBalanceResponse {
  pendingBalance: number;
  postedBalance: number;
  currency: string;
}

export interface PayoutParams {
  payoutId: string;
  agencyId: string;
  amount: number;
  currency: string;
  originatingInternalAccountId: string;
  receivingExternalAccountId: string;
  paymentType?: 'ach' | 'wire' | 'rtp';
  metadata?: Record<string, any>;
}

export interface IPaymentProvider {
  processACHPayment(request: ACHPaymentRequest): Promise<ACHPaymentResponse>;
  getPaymentStatus(paymentOrderId: string): Promise<ACHPaymentResponse>;
  verifyWebhookSignature(rawBody: string, signature: string): boolean;
  createLegalEntity(params: LegalEntityParams): Promise<{ legalEntityId: string; status: string }>;
  getLegalEntityStatus(legalEntityId: string): Promise<{ legalEntityId: string; status: string }>;
  createCounterparty(params: CounterpartyParams): Promise<{ counterpartyId: string }>;
  createExternalAccount(params: ExternalAccountParams): Promise<{ externalAccountId: string }>;
  createInternalAccount(params: InternalAccountParams): Promise<{ internalAccountId: string; ledgerAccountId?: string }>;
  getLedgerAccountBalance(ledgerAccountId: string): Promise<LedgerBalanceResponse>;
  createPayout(params: PayoutParams): Promise<ACHPaymentResponse>;
}



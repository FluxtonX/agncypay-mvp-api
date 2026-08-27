/**
 * Provider-neutral Financial Provider Interface
 *
 * Designed around the Cybrid API surface but kept provider-agnostic
 * so a future provider swap does not require rewriting business logic.
 *
 * Every method returns typed response objects — never raw HTTP responses.
 */

// ─── Customer ────────────────────────────────────────────────────

export interface CreateBusinessCustomerParams {
  name: string;
  type: 'business' | 'individual';
  bankGuid: string;
  email?: string;
  phone?: string;
  metadata?: Record<string, any>;
}

export interface CustomerResponse {
  guid: string;
  name: string;
  type: string;
  state: string;
  bankGuid: string;
  createdAt: string;
}

// ─── Identity Verification (KYB / KYC) ──────────────────────────

export interface CreateIdentityVerificationParams {
  customerGuid: string;
  type: 'kyc' | 'bank_account' | 'counterparty';
  method: 'business_registration' | 'id_and_selfie' | 'attested' | 'plaid_identity_match';
  countryCode?: string;
  name?: {
    first: string;
    last: string;
  };
  address?: {
    street: string;
    city: string;
    subdivision: string;
    postalCode: string;
    countryCode: string;
  };
  dateOfBirth?: string;
  identificationType?: string;
  identificationValue?: string;
}

export interface IdentityVerificationResponse {
  guid: string;
  customerGuid: string;
  type: string;
  method: string;
  state: string;
  outcome?: string;
  failureCodes?: string[];
  createdAt: string;
}

// ─── Accounts ────────────────────────────────────────────────────

export interface CreateAccountParams {
  customerGuid?: string; // omit for bank-owned accounts
  type: 'trading' | 'fiat' | 'fee' | 'gas' | 'reserve';
  asset: string; // e.g. 'USD', 'USDC'
  name?: string;
}

export interface AccountResponse {
  guid: string;
  customerGuid?: string;
  type: string;
  asset: string;
  name?: string;
  state: string;
  platformBalance?: string;
  platformAvailable?: string;
  createdAt: string;
}

// ─── Deposit Bank Accounts ───────────────────────────────────────

export interface CreateDepositBankAccountParams {
  accountGuid: string;
  type?: string;
}

export interface DepositBankAccountResponse {
  guid: string;
  accountGuid: string;
  state: string;
  uniqueMemoId?: string;
  routingNumberType?: string;
  routingNumber?: string;
  accountNumber?: string;
  bankName?: string;
  label?: string;
  createdAt: string;
}

// ─── External Bank Accounts ─────────────────────────────────────

export interface CreateExternalBankAccountParams {
  name: string;
  customerGuid?: string;
  asset: string;
  accountKind: 'plaid' | 'plaid_processor_token' | 'raw_routing_details';
  // For plaid_processor_token
  plaidProcessorToken?: string;
  plaidInstitutionId?: string;
  plaidAccountMask?: string;
  plaidAccountName?: string;
  // For raw_routing_details
  routingNumberType?: string;
  routingNumber?: string;
  accountNumber?: string;
  counterpartyGuid?: string;
}

export interface ExternalBankAccountResponse {
  guid: string;
  name: string;
  customerGuid?: string;
  asset: string;
  accountKind: string;
  state: string;
  failureCode?: string;
  bankName?: string;
  mask?: string;
  createdAt: string;
}

// ─── Counterparties ─────────────────────────────────────────────

export interface CreateCounterpartyParams {
  customerGuid: string;
  type: 'individual' | 'business';
  name: {
    first?: string;
    middle?: string;
    last?: string;
    full?: string;
  };
  address?: {
    street: string;
    street2?: string;
    city: string;
    subdivision?: string;
    postalCode: string;
    countryCode: string;
  };
  dateOfBirth?: string;
  email?: string;
  phone?: string;
  labels?: string[];
}

export interface CounterpartyResponse {
  guid: string;
  customerGuid: string;
  type: string;
  name: Record<string, string>;
  state: string;
  createdAt: string;
}

// ─── Quotes ─────────────────────────────────────────────────────

export interface CreateQuoteParams {
  customerGuid: string;
  productType: 'trading' | 'funding' | 'book_transfer' | 'crypto_transfer';
  asset?: string;
  side?: 'buy' | 'sell';
  receiveAmount?: string;
  deliverAmount?: string;
  networkAddress?: string;
}

export interface QuoteResponse {
  guid: string;
  customerGuid: string;
  productType: string;
  side?: string;
  asset?: string;
  receiveAmount?: string;
  deliverAmount?: string;
  fee?: string;
  issuedAt: string;
  expiresAt: string;
  createdAt: string;
}

// ─── Transfers ──────────────────────────────────────────────────

export interface CreateTransferParams {
  quoteGuid: string;
  transferType: 'funding' | 'book' | 'crypto' | 'instant_funding' | 'lightning';
  sourceAccountGuid?: string;
  sourceParticipant?: {
    type: string;
    guid: string;
  };
  destinationAccountGuid?: string;
  destinationParticipant?: {
    type: string;
    guid: string;
  };
  externalBankAccountGuid?: string;
  labels?: string[];
}

export interface TransferResponse {
  guid: string;
  quoteGuid: string;
  transferType: string;
  customerGuid?: string;
  sourceAccountGuid?: string;
  destinationAccountGuid?: string;
  externalBankAccountGuid?: string;
  state: string;
  amount?: string;
  fee?: string;
  estimatedAmount?: string;
  failureCode?: string;
  createdAt: string;
  updatedAt?: string;
}

// ─── Trades ─────────────────────────────────────────────────────

export interface CreateTradeParams {
  quoteGuid: string;
  expectedError?: string;
  labels?: string[];
}

export interface TradeResponse {
  guid: string;
  quoteGuid: string;
  customerGuid?: string;
  side?: string;
  symbol?: string;
  receiveAmount?: string;
  deliverAmount?: string;
  fee?: string;
  state: string;
  failureCode?: string;
  createdAt: string;
}

// ─── Workflows (for Plaid exchange / external bank linking) ─────

export interface CreateWorkflowParams {
  type: 'plaid';
  customerGuid?: string;
  externalBankAccountGuid?: string;
  kind?: string;
  language?: string;
  linkCustomizationName?: string;
  redirectUri?: string;
  androidPackageName?: string;
}

export interface WorkflowResponse {
  guid: string;
  customerGuid?: string;
  type: string;
  state: string;
  plaidLinkToken?: string;
  externalBankAccountGuid?: string;
  failureCode?: string;
  createdAt: string;
}

// ─── Provider Interface ─────────────────────────────────────────

export interface IFinancialProvider {
  // Authentication
  authenticate(): Promise<string>;

  // Customers
  createCustomer(params: CreateBusinessCustomerParams): Promise<CustomerResponse>;
  getCustomer(guid: string): Promise<CustomerResponse>;

  // Identity Verification (KYB)
  createIdentityVerification(params: CreateIdentityVerificationParams): Promise<IdentityVerificationResponse>;
  getIdentityVerification(guid: string): Promise<IdentityVerificationResponse>;

  // Accounts
  createAccount(params: CreateAccountParams): Promise<AccountResponse>;
  getAccount(guid: string): Promise<AccountResponse>;
  listAccounts(params?: { customerGuid?: string; type?: string }): Promise<AccountResponse[]>;

  // Deposit Bank Accounts
  createDepositBankAccount(params: CreateDepositBankAccountParams): Promise<DepositBankAccountResponse>;
  getDepositBankAccount(guid: string): Promise<DepositBankAccountResponse>;

  // External Bank Accounts
  createExternalBankAccount(params: CreateExternalBankAccountParams): Promise<ExternalBankAccountResponse>;
  getExternalBankAccount(guid: string): Promise<ExternalBankAccountResponse>;
  listExternalBankAccounts(params?: { customerGuid?: string }): Promise<ExternalBankAccountResponse[]>;

  // Counterparties
  createCounterparty(params: CreateCounterpartyParams): Promise<CounterpartyResponse>;
  getCounterparty(guid: string): Promise<CounterpartyResponse>;
  listCounterparties(customerGuid: string): Promise<CounterpartyResponse[]>;

  // Quotes
  createQuote(params: CreateQuoteParams): Promise<QuoteResponse>;
  getQuote(guid: string): Promise<QuoteResponse>;

  // Transfers
  createTransfer(params: CreateTransferParams): Promise<TransferResponse>;
  getTransfer(guid: string): Promise<TransferResponse>;

  // Trades
  createTrade(params: CreateTradeParams): Promise<TradeResponse>;
  getTrade(guid: string): Promise<TradeResponse>;

  // Workflows
  createWorkflow(params: CreateWorkflowParams): Promise<WorkflowResponse>;
  getWorkflow(guid: string): Promise<WorkflowResponse>;

  // Webhook Signature Verification
  verifyWebhookSignature(payload: string, signature: string): boolean;
}

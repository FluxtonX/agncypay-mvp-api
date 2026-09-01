/**
 * Provider-neutral Financial Provider Interface
 *
 * Designed and verified against the official Cybrid OpenAPI specifications.
 * Every method returns typed response objects — never raw HTTP responses.
 */

// ─── Customer ────────────────────────────────────────────────────

export interface CreateBusinessCustomerParams {
  name: string;
  type: 'business' | 'individual';
  bankGuid?: string;
  email?: string;
  phone?: string;
  metadata?: Record<string, any>;
}

export interface CustomerResponse {
  guid: string;
  name: string;
  type: string;
  state: string;
  bankGuid?: string;
  createdAt: string;
}

// ─── Identity Verification (KYB / KYC) ──────────────────────────

export interface CreateIdentityVerificationParams {
  customerGuid: string;
  type: 'kyc' | 'bank_account' | 'counterparty';
  method:
    | 'business_registration'
    | 'id_and_selfie'
    | 'attested'
    | 'attested_business_registration'
    | 'plaid_identity_match'
    | 'tax_id_and_regex'
    | 'bank_account';
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
  identificationType?: 'social_security_number' | 'tax_identification_number' | 'passport_number' | 'drivers_license';
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
  type: 'trading' | 'fiat' | 'invoice_operations' | 'storage';
  asset: string; // e.g. 'USD', 'USDC'
  name: string;
}

export interface AccountResponse {
  guid: string;
  customerGuid?: string;
  type: string;
  asset: string;
  name: string;
  state: string;
  platformBalance?: string;
  platformAvailable?: string;
  createdAt: string;
}

// ─── Deposit Bank Accounts ───────────────────────────────────────

export interface CreateDepositBankAccountParams {
  accountGuid: string;
  type: 'main' | 'sub_account';
  customerGuid?: string;
  name?: string;
}

export interface DepositBankAccountResponse {
  guid: string;
  accountGuid: string;
  customerGuid?: string;
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
  accountKind: 'plaid' | 'plaid_processor_token' | 'raw_routing_details';
  customerGuid?: string;
  asset?: string;
  // For plaid_processor_token
  plaidProcessorToken?: string;
  plaidInstitutionId?: string;
  plaidAccountMask?: string;
  plaidAccountName?: string;
  // For raw_routing_details
  counterpartyGuid?: string;
  routingNumberType?: 'CPA' | 'ABA' | 'IFSC';
  routingNumber?: string;
  accountNumber?: string;
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
  address: {
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
  symbol?: string;
  side?: 'deposit' | 'withdrawal' | 'buy' | 'sell';
  receiveAmount?: number; // integer (minor units / cents)
  deliverAmount?: number; // integer (minor units / cents)
  networkAddress?: string;
  paymentRail?: 'ach' | 'eft' | 'wire' | 'rtp' | 'etransfer';
}

export interface QuoteResponse {
  guid: string;
  customerGuid: string;
  productType: string;
  side?: string;
  asset?: string;
  receiveAmount?: number;
  deliverAmount?: number;
  fee?: number;
  issuedAt: string;
  expiresAt: string;
  createdAt: string;
}

export interface TransferParticipant {
  type: 'customer' | 'bank' | 'counterparty';
  guid: string;
  amount: number;
}

export interface CreateTransferParams {
  quoteGuid: string;
  transferType: 'funding' | 'crypto' | 'instant_funding' | 'inter_account' | 'lightning' | 'book';
  paymentRail?: 'ach' | 'eft' | 'wire' | 'rtp' | 'etransfer';
  fiatAccountGuid?: string;
  sourceAccountGuid?: string;
  destinationAccountGuid?: string;
  externalBankAccountGuid?: string;
  beneficiaryMemo?: string;
  sourceParticipants?: TransferParticipant[];
  destinationParticipants?: TransferParticipant[];
  expectedState?: 'pending' | 'in_progress' | 'completed';
  expectedBehaviours?: string[];
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
  amount?: number;
  fee?: number;
  estimatedAmount?: number;
  failureCode?: string;
  createdAt: string;
  updatedAt?: string;
}

// ─── Trades ─────────────────────────────────────────────────────

export interface CreateTradeParams {
  quoteGuid: string;
  expectedError?: 'expired_quote' | 'non_sufficient_funds';
  labels?: string[];
}

export interface TradeResponse {
  guid: string;
  quoteGuid: string;
  customerGuid?: string;
  side?: string;
  symbol?: string;
  receiveAmount?: number;
  deliverAmount?: number;
  fee?: number;
  state: string;
  failureCode?: string;
  createdAt: string;
}

// ─── Plans & Executions (Remittance) ────────────────────────────

export interface CreatePlanParams {
  type: 'remittance' | 'disbursement' | 'invoice_pay';
  customerGuid: string;
  sourceAccount: {
    type: 'customer' | 'bank';
    guid: string;
  };
  destinationAccount: {
    type: 'customer' | 'bank';
    guid: string;
  };
  purposeOfTransaction?: string;
}

export interface PlanResponse {
  guid: string;
  type: string;
  state: string;
  failureCode?: string;
  createdAt: string;
  expiresAt?: string;
}

export interface CreateExecutionParams {
  planGuid: string;
}

export interface ExecutionResponse {
  guid: string;
  planGuid: string;
  type: string;
  state: string;
  failureCode?: string;
  createdAt: string;
}

// ─── Workflows ──────────────────────────────────────────────────

export interface CreateWorkflowParams {
  type: 'plaid';
  customerGuid?: string;
  externalBankAccountGuid?: string;
  kind?: 'link_token_create' | 'link_token_update';
  language?: 'en' | 'fr' | 'es' | 'nl' | 'de';
  linkCustomizationName?: string;
  redirectUri?: string;
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

// ─── Financial Provider Contract ────────────────────────────────

export interface IFinancialProvider {
  authenticate(): Promise<string>;

  createCustomer(params: CreateBusinessCustomerParams): Promise<CustomerResponse>;
  getCustomer(guid: string): Promise<CustomerResponse>;
  listCustomers(params?: { page?: number; perPage?: number; type?: string; guid?: string; label?: string; includePii?: boolean }): Promise<CustomerResponse[]>;
  updateCustomer(guid: string, params: { state?: string }): Promise<CustomerResponse>;

  createIdentityVerification(params: CreateIdentityVerificationParams): Promise<IdentityVerificationResponse>;
  getIdentityVerification(guid: string): Promise<IdentityVerificationResponse>;

  createAccount(params: CreateAccountParams): Promise<AccountResponse>;
  getAccount(guid: string): Promise<AccountResponse>;
  listAccounts(params?: { customerGuid?: string; type?: string }): Promise<AccountResponse[]>;

  createDepositBankAccount(params: CreateDepositBankAccountParams): Promise<DepositBankAccountResponse>;
  getDepositBankAccount(guid: string): Promise<DepositBankAccountResponse>;

  createExternalBankAccount(params: CreateExternalBankAccountParams): Promise<ExternalBankAccountResponse>;
  getExternalBankAccount(guid: string): Promise<ExternalBankAccountResponse>;
  listExternalBankAccounts(params?: { customerGuid?: string }): Promise<ExternalBankAccountResponse[]>;

  createCounterparty(params: CreateCounterpartyParams): Promise<CounterpartyResponse>;
  getCounterparty(guid: string): Promise<CounterpartyResponse>;
  listCounterparties(customerGuid: string): Promise<CounterpartyResponse[]>;

  createQuote(params: CreateQuoteParams): Promise<QuoteResponse>;
  getQuote(guid: string): Promise<QuoteResponse>;

  createTransfer(params: CreateTransferParams): Promise<TransferResponse>;
  getTransfer(guid: string): Promise<TransferResponse>;
  cancelTransfer(guid: string): Promise<TransferResponse>;

  createTrade(params: CreateTradeParams): Promise<TradeResponse>;
  getTrade(guid: string): Promise<TradeResponse>;

  createPlan(params: CreatePlanParams): Promise<PlanResponse>;
  getPlan(guid: string): Promise<PlanResponse>;

  createExecution(params: CreateExecutionParams): Promise<ExecutionResponse>;
  getExecution(guid: string): Promise<ExecutionResponse>;

  createWorkflow(params: CreateWorkflowParams): Promise<WorkflowResponse>;
  getWorkflow(guid: string): Promise<WorkflowResponse>;

  verifyWebhookSignature(payload: string, signature: string): boolean;
}

/**
 * Cybrid API Request/Response Types
 *
 * Hand-written DTOs sourced from Cybrid's published OpenAPI spec.
 * Only includes the operations we actually use (~12 operations).
 */

// ─── Authentication ─────────────────────────────────────────────

export interface CybridTokenRequest {
  grant_type: 'client_credentials';
  client_id: string;
  client_secret: string;
  scope: string;
}

export interface CybridTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
}

// ─── Customer ───────────────────────────────────────────────────

export interface CybridCreateCustomerRequest {
  type: 'business' | 'individual';
  name?: CybridCustomerName;
  address?: CybridAddress;
  date_of_birth?: string;
  phone_number?: string;
  email_address?: string;
  identification_numbers?: CybridIdentificationNumber[];
  labels?: string[];
}

export interface CybridCustomerName {
  first?: string;
  middle?: string;
  last?: string;
  full?: string;
}

export interface CybridAddress {
  street: string;
  street2?: string;
  city: string;
  subdivision?: string;
  postal_code: string;
  country_code: string;
}

export interface CybridIdentificationNumber {
  type: 'social_security_number' | 'tax_identification_number' | 'passport_number' | 'drivers_license';
  issuing_country_code?: string;
  identification_value: string;
}

export interface CybridCustomerResponse {
  guid: string;
  bank_guid: string;
  type: string;
  name?: CybridCustomerName;
  state: string; // 'storing' | 'verified' | 'unverified' | 'rejected' | 'frozen'
  created_at: string;
  updated_at?: string;
}

// ─── Identity Verification ──────────────────────────────────────

export interface CybridCreateIdentityVerificationRequest {
  type: 'kyc' | 'bank_account' | 'counterparty';
  method: 'business_registration' | 'id_and_selfie' | 'attested' | 'plaid_identity_match' | 'attested_ownership';
  customer_guid: string;
  country_code?: string;
  name?: CybridCustomerName;
  address?: CybridAddress;
  date_of_birth?: string;
  identification_numbers?: CybridIdentificationNumber[];
  expected_behaviours?: string[];
}

export interface CybridIdentityVerificationResponse {
  guid: string;
  customer_guid: string;
  type: string;
  method: string;
  state: string; // 'storing' | 'waiting' | 'expired' | 'completed'
  outcome?: string; // 'passed' | 'failed'
  failure_codes?: string[];
  created_at: string;
  updated_at?: string;
}

// ─── Account ────────────────────────────────────────────────────

export interface CybridCreateAccountRequest {
  type: 'trading' | 'fiat' | 'fee' | 'gas' | 'reserve';
  customer_guid?: string;
  asset: string;
  name?: string;
  labels?: string[];
}

export interface CybridAccountResponse {
  guid: string;
  type: string;
  bank_guid: string;
  customer_guid?: string;
  asset: string;
  name?: string;
  state: string; // 'storing' | 'created'
  platform_balance?: string;
  platform_available?: string;
  created_at: string;
  updated_at?: string;
}

export interface CybridAccountListResponse {
  total: number;
  page: number;
  per_page: number;
  objects: CybridAccountResponse[];
}

// ─── Deposit Bank Account ───────────────────────────────────────

export interface CybridCreateDepositBankAccountRequest {
  account_guid: string;
  type?: string;
  labels?: string[];
}

export interface CybridDepositBankAccountResponse {
  guid: string;
  bank_guid: string;
  customer_guid?: string;
  account_guid: string;
  state: string;
  unique_memo_id?: string;
  routing_number_type?: string;
  routing_number?: string;
  account_number?: string;
  bank_name?: string;
  label?: string;
  type?: string;
  created_at: string;
  updated_at?: string;
}

// ─── External Bank Account ──────────────────────────────────────

export interface CybridCreateExternalBankAccountRequest {
  name: string;
  account_kind: 'plaid' | 'plaid_processor_token' | 'raw_routing_details';
  customer_guid?: string;
  asset: string;
  // For plaid_processor_token
  plaid_processor_token?: string;
  plaid_institution_id?: string;
  plaid_account_mask?: string;
  plaid_account_name?: string;
  // For raw_routing_details
  routing_number_type?: string;
  routing_number?: string;
  account_number?: string;
  counterparty_guid?: string;
  labels?: string[];
}

export interface CybridExternalBankAccountResponse {
  guid: string;
  name: string;
  bank_guid: string;
  customer_guid?: string;
  asset: string;
  account_kind: string;
  state: string; // 'storing' | 'completed' | 'failed' | 'refresh_required' | 'deleting' | 'deleted'
  failure_code?: string;
  bank_name?: string;
  mask?: string;
  created_at: string;
  updated_at?: string;
}

export interface CybridExternalBankAccountListResponse {
  total: number;
  page: number;
  per_page: number;
  objects: CybridExternalBankAccountResponse[];
}

// ─── Counterparty ───────────────────────────────────────────────

export interface CybridCreateCounterpartyRequest {
  type: 'individual' | 'business';
  customer_guid: string;
  name: CybridCustomerName;
  address?: CybridAddress;
  date_of_birth?: string;
  email_address?: string;
  phone_number?: string;
  labels?: string[];
}

export interface CybridCounterpartyResponse {
  guid: string;
  bank_guid: string;
  customer_guid: string;
  type: string;
  name: CybridCustomerName;
  state: string; // 'storing' | 'unverified' | 'verified' | 'rejected'
  created_at: string;
  updated_at?: string;
}

export interface CybridCounterpartyListResponse {
  total: number;
  page: number;
  per_page: number;
  objects: CybridCounterpartyResponse[];
}

// ─── Quote ──────────────────────────────────────────────────────

export interface CybridCreateQuoteRequest {
  product_type: 'trading' | 'funding' | 'book_transfer' | 'crypto_transfer';
  customer_guid: string;
  asset?: string;
  symbol?: string;
  side?: 'buy' | 'sell';
  receive_amount?: string;
  deliver_amount?: string;
  fees?: CybridFee[];
}

export interface CybridFee {
  type: string;
  spread_fee?: string;
  fixed_fee?: string;
}

export interface CybridQuoteResponse {
  guid: string;
  product_type: string;
  bank_guid: string;
  customer_guid: string;
  side?: string;
  symbol?: string;
  asset?: string;
  receive_amount?: string;
  deliver_amount?: string;
  fee?: string;
  issued_at: string;
  expires_at: string;
  created_at: string;
  updated_at?: string;
}

// ─── Transfer ───────────────────────────────────────────────────

export interface CybridCreateTransferRequest {
  quote_guid: string;
  transfer_type: 'funding' | 'book' | 'crypto' | 'instant_funding' | 'lightning';
  source_account_guid?: string;
  source_participant?: CybridParticipant;
  destination_account_guid?: string;
  destination_participant?: CybridParticipant;
  external_bank_account_guid?: string;
  external_wallet_guid?: string;
  labels?: string[];
}

export interface CybridParticipant {
  type: string;
  guid: string;
}

export interface CybridTransferResponse {
  guid: string;
  bank_guid: string;
  customer_guid?: string;
  quote_guid: string;
  transfer_type: string;
  source_account?: CybridTransferAccount;
  destination_account?: CybridTransferAccount;
  external_bank_account_guid?: string;
  state: string; // 'storing' | 'initiating' | 'reviewing' | 'pending' | 'completed' | 'failed' | 'returned'
  amount?: string;
  fee?: string;
  estimated_amount?: string;
  failure_code?: string;
  created_at: string;
  updated_at?: string;
}

export interface CybridTransferAccount {
  type: string;
  guid: string;
}

// ─── Trade ──────────────────────────────────────────────────────

export interface CybridCreateTradeRequest {
  quote_guid: string;
  expected_error?: string;
  labels?: string[];
}

export interface CybridTradeResponse {
  guid: string;
  bank_guid: string;
  customer_guid?: string;
  quote_guid: string;
  side?: string;
  symbol?: string;
  receive_amount?: string;
  deliver_amount?: string;
  fee?: string;
  state: string; // 'storing' | 'initiating' | 'pending' | 'settling' | 'completed' | 'failed'
  failure_code?: string;
  created_at: string;
  updated_at?: string;
}

// ─── Workflow ───────────────────────────────────────────────────

export interface CybridCreateWorkflowRequest {
  type: 'plaid';
  customer_guid?: string;
  external_bank_account_guid?: string;
  kind?: string;
  language?: string;
  link_customization_name?: string;
  redirect_uri?: string;
  android_package_name?: string;
}

export interface CybridWorkflowResponse {
  guid: string;
  bank_guid: string;
  customer_guid?: string;
  type: string;
  state: string; // 'storing' | 'completed' | 'failed'
  plaid_link_token?: string;
  external_bank_account_guid?: string;
  failure_code?: string;
  created_at: string;
  updated_at?: string;
}

// ─── Webhook / Subscription Event ───────────────────────────────

export interface CybridSubscriptionEventPayload {
  guid: string;
  event_type: string;
  action: string;
  object_guid: string;
  status: string;
  environment: string;
  created_at: string;
  updated_at?: string;
}

// ─── Pagination ─────────────────────────────────────────────────

export interface CybridListParams {
  page?: number;
  per_page?: number;
  guid?: string;
  bank_guid?: string;
  customer_guid?: string;
  type?: string;
  state?: string;
  label?: string;
}

// ─── Error ──────────────────────────────────────────────────────

export interface CybridErrorResponse {
  status: number;
  error_message: string;
  message_code: string;
}

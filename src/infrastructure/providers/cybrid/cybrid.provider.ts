import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { CybridHttpClient } from './cybrid-http.client';
import { CybridConfigService } from './cybrid-config.service';
import {
  IFinancialProvider,
  CreateBusinessCustomerParams,
  CustomerResponse,
  CreateIdentityVerificationParams,
  IdentityVerificationResponse,
  CreateAccountParams,
  AccountResponse,
  CreateDepositBankAccountParams,
  DepositBankAccountResponse,
  CreateExternalBankAccountParams,
  ExternalBankAccountResponse,
  CreateCounterpartyParams,
  CounterpartyResponse,
  CreateQuoteParams,
  QuoteResponse,
  CreateTransferParams,
  TransferResponse,
  CreateTradeParams,
  TradeResponse,
  CreatePlanParams,
  PlanResponse,
  CreateExecutionParams,
  ExecutionResponse,
  CreateWorkflowParams,
  WorkflowResponse,
} from '../../../core/interfaces/financial-provider.interface';
import {
  CybridCustomerResponse,
  CybridCreateCustomerRequest,
  CybridIdentityVerificationResponse,
  CybridCreateIdentityVerificationRequest,
  CybridAccountResponse,
  CybridCreateAccountRequest,
  CybridAccountListResponse,
  CybridDepositBankAccountResponse,
  CybridCreateDepositBankAccountRequest,
  CybridExternalBankAccountResponse,
  CybridCreateExternalBankAccountRequest,
  CybridExternalBankAccountListResponse,
  CybridCounterpartyResponse,
  CybridCreateCounterpartyRequest,
  CybridCounterpartyListResponse,
  CybridQuoteResponse,
  CybridCreateQuoteRequest,
  CybridTransferResponse,
  CybridCreateTransferRequest,
  CybridTradeResponse,
  CybridCreateTradeRequest,
  CybridPlanResponse,
  CybridCreatePlanRequest,
  CybridExecutionResponse,
  CybridCreateExecutionRequest,
  CybridWorkflowResponse,
  CybridCreateWorkflowRequest,
} from './cybrid.types';

@Injectable()
export class CybridProvider implements IFinancialProvider {
  private readonly logger = new Logger(CybridProvider.name);

  constructor(
    private readonly http: CybridHttpClient,
    private readonly config: CybridConfigService,
  ) {}

  async authenticate(): Promise<string> {
    return this.http.authenticate();
  }

  // ─── Customers ───────────────────────────────────────────────

  async createCustomer(params: CreateBusinessCustomerParams): Promise<CustomerResponse> {
    const body: CybridCreateCustomerRequest = {
      type: params.type,
      name: { full: params.name },
    };

    if (params.email) {
      body.email_address = params.email;
    }
    if (params.phone) {
      body.phone_number = params.phone;
    }

    const resp = await this.http.post<CybridCustomerResponse>(
      '/api/customers',
      body,
    );

    return this.mapCustomerResponse(resp);
  }

  async getCustomer(guid: string): Promise<CustomerResponse> {
    const resp = await this.http.get<CybridCustomerResponse>(
      `/api/customers/${guid}`,
    );
    return this.mapCustomerResponse(resp);
  }

  // ─── Identity Verification (KYB) ────────────────────────────

  async createIdentityVerification(
    params: CreateIdentityVerificationParams,
  ): Promise<IdentityVerificationResponse> {
    const body: CybridCreateIdentityVerificationRequest = {
      type: params.type,
      method: params.method,
      customer_guid: params.customerGuid,
      country_code: params.countryCode,
    };

    if (params.name) {
      body.name = { first: params.name.first, last: params.name.last };
    }

    if (params.address) {
      body.address = {
        street: params.address.street,
        city: params.address.city,
        subdivision: params.address.subdivision,
        postal_code: params.address.postalCode,
        country_code: params.address.countryCode,
      };
    }

    if (params.dateOfBirth) {
      body.date_of_birth = params.dateOfBirth;
    }

    if (params.identificationValue) {
      body.identification_numbers = [{
        type: params.identificationType || 'tax_identification_number',
        identification_value: params.identificationValue,
      }];
    }

    if (this.config.isSandbox) {
      body.expected_behaviours = ['passed_immediately'];
    }

    const resp = await this.http.post<CybridIdentityVerificationResponse>(
      '/api/identity_verifications',
      body,
    );

    return this.mapIdentityVerificationResponse(resp);
  }

  async getIdentityVerification(guid: string): Promise<IdentityVerificationResponse> {
    const resp = await this.http.get<CybridIdentityVerificationResponse>(
      `/api/identity_verifications/${guid}`,
    );
    return this.mapIdentityVerificationResponse(resp);
  }

  // ─── Accounts ────────────────────────────────────────────────

  async createAccount(params: CreateAccountParams): Promise<AccountResponse> {
    const body: CybridCreateAccountRequest = {
      type: params.type,
      asset: params.asset,
      customer_guid: params.customerGuid,
      name: params.name,
    };

    const resp = await this.http.post<CybridAccountResponse>(
      '/api/accounts',
      body,
    );

    return this.mapAccountResponse(resp);
  }

  async getAccount(guid: string): Promise<AccountResponse> {
    const resp = await this.http.get<CybridAccountResponse>(
      `/api/accounts/${guid}`,
    );
    return this.mapAccountResponse(resp);
  }

  async listAccounts(params?: { customerGuid?: string; type?: string }): Promise<AccountResponse[]> {
    const query: Record<string, any> = {};
    if (params?.customerGuid) query.customer_guid = params.customerGuid;
    if (params?.type) query.type = params.type;

    const resp = await this.http.get<CybridAccountListResponse>(
      '/api/accounts',
      query,
    );

    return resp.objects.map((a) => this.mapAccountResponse(a));
  }

  // ─── Deposit Bank Accounts ──────────────────────────────────

  async createDepositBankAccount(
    params: CreateDepositBankAccountParams,
  ): Promise<DepositBankAccountResponse> {
    const body: CybridCreateDepositBankAccountRequest = {
      account_guid: params.accountGuid,
      type: params.type,
      name: params.name,
      customer_guid: params.customerGuid,
    };

    const resp = await this.http.post<CybridDepositBankAccountResponse>(
      '/api/deposit_bank_accounts',
      body,
    );

    return this.mapDepositBankAccountResponse(resp);
  }

  async getDepositBankAccount(guid: string): Promise<DepositBankAccountResponse> {
    const resp = await this.http.get<CybridDepositBankAccountResponse>(
      `/api/deposit_bank_accounts/${guid}`,
    );
    return this.mapDepositBankAccountResponse(resp);
  }

  // ─── External Bank Accounts ──────────────────────────────────

  async createExternalBankAccount(
    params: CreateExternalBankAccountParams,
  ): Promise<ExternalBankAccountResponse> {
    const body: CybridCreateExternalBankAccountRequest = {
      name: params.name,
      account_kind: params.accountKind,
      customer_guid: params.customerGuid,
      asset: params.asset,
    };

    if (params.accountKind === 'plaid_processor_token') {
      body.plaid_processor_token = params.plaidProcessorToken;
      body.plaid_institution_id = params.plaidInstitutionId;
      body.plaid_account_mask = params.plaidAccountMask;
      body.plaid_account_name = params.plaidAccountName;
    }

    if (params.accountKind === 'raw_routing_details') {
      body.counterparty_guid = params.counterpartyGuid;
      body.counterparty_bank_account = {
        routing_number_type: params.routingNumberType || 'ABA',
        routing_number: params.routingNumber,
        account_number: params.accountNumber,
      };
    }

    const resp = await this.http.post<CybridExternalBankAccountResponse>(
      '/api/external_bank_accounts',
      body,
    );

    return this.mapExternalBankAccountResponse(resp);
  }

  async getExternalBankAccount(guid: string): Promise<ExternalBankAccountResponse> {
    const resp = await this.http.get<CybridExternalBankAccountResponse>(
      `/api/external_bank_accounts/${guid}`,
    );
    return this.mapExternalBankAccountResponse(resp);
  }

  async listExternalBankAccounts(
    params?: { customerGuid?: string },
  ): Promise<ExternalBankAccountResponse[]> {
    const query: Record<string, any> = {};
    if (params?.customerGuid) query.customer_guid = params.customerGuid;

    const resp = await this.http.get<CybridExternalBankAccountListResponse>(
      '/api/external_bank_accounts',
      query,
    );

    return resp.objects.map((a) => this.mapExternalBankAccountResponse(a));
  }

  // ─── Counterparties ──────────────────────────────────────────

  async createCounterparty(params: CreateCounterpartyParams): Promise<CounterpartyResponse> {
    const body: CybridCreateCounterpartyRequest = {
      type: params.type,
      customer_guid: params.customerGuid,
      name: {
        first: params.name.first,
        last: params.name.last,
        full: params.name.full,
      },
      address: {
        street: params.address.street || '123 Market St',
        street2: params.address.street2,
        city: params.address.city || 'San Francisco',
        subdivision: params.address.subdivision || 'CA',
        postal_code: params.address.postalCode || '94105',
        country_code: params.address.countryCode || 'US',
      },
    };

    if (params.dateOfBirth) body.date_of_birth = params.dateOfBirth;
    if (params.email) body.email_address = params.email;
    if (params.phone) body.phone_number = params.phone;

    const resp = await this.http.post<CybridCounterpartyResponse>(
      '/api/counterparties',
      body,
    );

    return this.mapCounterpartyResponse(resp);
  }

  async getCounterparty(guid: string): Promise<CounterpartyResponse> {
    const resp = await this.http.get<CybridCounterpartyResponse>(
      `/api/counterparties/${guid}`,
    );
    return this.mapCounterpartyResponse(resp);
  }

  async listCounterparties(customerGuid: string): Promise<CounterpartyResponse[]> {
    const resp = await this.http.get<CybridCounterpartyListResponse>(
      '/api/counterparties',
      { customer_guid: customerGuid },
    );

    return resp.objects.map((c) => this.mapCounterpartyResponse(c));
  }

  // ─── Quotes ──────────────────────────────────────────────────

  async createQuote(params: CreateQuoteParams): Promise<QuoteResponse> {
    const body: CybridCreateQuoteRequest = {
      product_type: params.productType,
      customer_guid: params.customerGuid,
      asset: params.asset,
      symbol: params.symbol || (params.productType === 'trading' ? 'USDC-USD' : undefined),
      side: params.side,
      receive_amount: params.receiveAmount,
      deliver_amount: params.deliverAmount,
      payment_rail: params.paymentRail,
    };

    const resp = await this.http.post<CybridQuoteResponse>(
      '/api/quotes',
      body,
    );

    return this.mapQuoteResponse(resp);
  }

  async getQuote(guid: string): Promise<QuoteResponse> {
    const resp = await this.http.get<CybridQuoteResponse>(
      `/api/quotes/${guid}`,
    );
    return this.mapQuoteResponse(resp);
  }

  // ─── Transfers ───────────────────────────────────────────────

  async createTransfer(params: CreateTransferParams): Promise<TransferResponse> {
    const body: CybridCreateTransferRequest = {
      quote_guid: params.quoteGuid,
      transfer_type: params.transferType,
      payment_rail: params.paymentRail,
      source_account_guid: params.sourceAccountGuid,
      destination_account_guid: params.destinationAccountGuid,
      external_bank_account_guid: params.externalBankAccountGuid,
      beneficiary_memo: params.beneficiaryMemo,
    };

    const resp = await this.http.post<CybridTransferResponse>(
      '/api/transfers',
      body,
    );

    return this.mapTransferResponse(resp);
  }

  async getTransfer(guid: string): Promise<TransferResponse> {
    const resp = await this.http.get<CybridTransferResponse>(
      `/api/transfers/${guid}`,
    );
    return this.mapTransferResponse(resp);
  }

  // ─── Trades ──────────────────────────────────────────────────

  async createTrade(params: CreateTradeParams): Promise<TradeResponse> {
    const body: CybridCreateTradeRequest = {
      quote_guid: params.quoteGuid,
      expected_error: params.expectedError,
    };

    const resp = await this.http.post<CybridTradeResponse>(
      '/api/trades',
      body,
    );

    return this.mapTradeResponse(resp);
  }

  async getTrade(guid: string): Promise<TradeResponse> {
    const resp = await this.http.get<CybridTradeResponse>(
      `/api/trades/${guid}`,
    );
    return this.mapTradeResponse(resp);
  }

  // ─── Plans & Executions (Remittance) ────────────────────────────

  async createPlan(params: CreatePlanParams): Promise<PlanResponse> {
    const body: CybridCreatePlanRequest = {
      type: params.type,
      customer_guid: params.customerGuid,
      source_account: params.sourceAccount,
      destination_account: params.destinationAccount,
      purpose_of_transaction: params.purposeOfTransaction || 'salary_payment',
    };

    const resp = await this.http.post<CybridPlanResponse>(
      '/api/plans',
      body,
    );

    return {
      guid: resp.guid,
      type: resp.type,
      state: resp.state,
      failureCode: resp.failure_code,
      createdAt: resp.created_at,
      expiresAt: resp.expires_at,
    };
  }

  async getPlan(guid: string): Promise<PlanResponse> {
    const resp = await this.http.get<CybridPlanResponse>(
      `/api/plans/${guid}`,
    );
    return {
      guid: resp.guid,
      type: resp.type,
      state: resp.state,
      failureCode: resp.failure_code,
      createdAt: resp.created_at,
      expiresAt: resp.expires_at,
    };
  }

  async createExecution(params: CreateExecutionParams): Promise<ExecutionResponse> {
    const body: CybridCreateExecutionRequest = {
      plan_guid: params.planGuid,
    };

    const resp = await this.http.post<CybridExecutionResponse>(
      '/api/executions',
      body,
    );

    return {
      guid: resp.guid,
      planGuid: resp.plan_guid,
      type: resp.type,
      state: resp.state,
      failureCode: resp.failure_code,
      createdAt: resp.created_at,
    };
  }

  async getExecution(guid: string): Promise<ExecutionResponse> {
    const resp = await this.http.get<CybridExecutionResponse>(
      `/api/executions/${guid}`,
    );
    return {
      guid: resp.guid,
      planGuid: resp.plan_guid,
      type: resp.type,
      state: resp.state,
      failureCode: resp.failure_code,
      createdAt: resp.created_at,
    };
  }

  // ─── Workflows ───────────────────────────────────────────────

  async createWorkflow(params: CreateWorkflowParams): Promise<WorkflowResponse> {
    const body: CybridCreateWorkflowRequest = {
      type: params.type,
      customer_guid: params.customerGuid,
      external_bank_account_guid: params.externalBankAccountGuid,
      kind: params.kind,
      language: params.language,
      link_customization_name: params.linkCustomizationName,
      redirect_uri: params.redirectUri,
    };

    const resp = await this.http.post<CybridWorkflowResponse>(
      '/api/workflows',
      body,
    );

    return this.mapWorkflowResponse(resp);
  }

  async getWorkflow(guid: string): Promise<WorkflowResponse> {
    const resp = await this.http.get<CybridWorkflowResponse>(
      `/api/workflows/${guid}`,
    );
    return this.mapWorkflowResponse(resp);
  }

  // ─── Webhook Signature Verification ──────────────────────────

  verifyWebhookSignature(payload: string, signature: string): boolean {
    if (!this.config.webhookSecret) {
      this.logger.warn('No webhook secret configured — skipping verification');
      return true;
    }

    try {
      const computed = crypto
        .createHmac('sha256', this.config.webhookSecret)
        .update(payload)
        .digest('hex');

      return crypto.timingSafeEqual(
        Buffer.from(computed, 'hex'),
        Buffer.from(signature, 'hex'),
      );
    } catch (error) {
      this.logger.error(`Webhook signature verification failed: ${error}`);
      return false;
    }
  }

  // ─── Response Mappers ────────────────────────────────────────

  private mapCustomerResponse(r: CybridCustomerResponse): CustomerResponse {
    return {
      guid: r.guid,
      name: r.name?.full || r.name?.first || '',
      type: r.type,
      state: r.state,
      bankGuid: r.bank_guid,
      createdAt: r.created_at,
    };
  }

  private mapIdentityVerificationResponse(
    r: CybridIdentityVerificationResponse,
  ): IdentityVerificationResponse {
    return {
      guid: r.guid,
      customerGuid: r.customer_guid,
      type: r.type,
      method: r.method,
      state: r.state,
      outcome: r.outcome,
      failureCodes: r.failure_codes,
      createdAt: r.created_at,
    };
  }

  private mapAccountResponse(r: CybridAccountResponse): AccountResponse {
    return {
      guid: r.guid,
      customerGuid: r.customer_guid,
      type: r.type,
      asset: r.asset,
      name: r.name,
      state: r.state,
      platformBalance: r.platform_balance,
      platformAvailable: r.platform_available,
      createdAt: r.created_at,
    };
  }

  private mapDepositBankAccountResponse(
    r: CybridDepositBankAccountResponse,
  ): DepositBankAccountResponse {
    return {
      guid: r.guid,
      accountGuid: r.account_guid,
      customerGuid: r.customer_guid,
      state: r.state,
      uniqueMemoId: r.unique_memo_id,
      routingNumberType: r.routing_number_type,
      routingNumber: r.routing_number,
      accountNumber: r.account_number,
      bankName: r.bank_name,
      label: r.label,
      createdAt: r.created_at,
    };
  }

  private mapExternalBankAccountResponse(
    r: CybridExternalBankAccountResponse,
  ): ExternalBankAccountResponse {
    return {
      guid: r.guid,
      name: r.name,
      customerGuid: r.customer_guid,
      asset: r.asset,
      accountKind: r.account_kind,
      state: r.state,
      failureCode: r.failure_code,
      bankName: r.bank_name,
      mask: r.mask,
      createdAt: r.created_at,
    };
  }

  private mapCounterpartyResponse(r: CybridCounterpartyResponse): CounterpartyResponse {
    return {
      guid: r.guid,
      customerGuid: r.customer_guid,
      type: r.type,
      name: r.name as unknown as Record<string, string>,
      state: r.state,
      createdAt: r.created_at,
    };
  }

  private mapQuoteResponse(r: CybridQuoteResponse): QuoteResponse {
    return {
      guid: r.guid,
      customerGuid: r.customer_guid,
      productType: r.product_type,
      side: r.side,
      asset: r.asset,
      receiveAmount: r.receive_amount,
      deliverAmount: r.deliver_amount,
      fee: r.fee,
      issuedAt: r.issued_at,
      expiresAt: r.expires_at,
      createdAt: r.created_at,
    };
  }

  private mapTransferResponse(r: CybridTransferResponse): TransferResponse {
    return {
      guid: r.guid,
      quoteGuid: r.quote_guid,
      transferType: r.transfer_type,
      customerGuid: r.customer_guid,
      sourceAccountGuid: r.source_account?.guid,
      destinationAccountGuid: r.destination_account?.guid,
      externalBankAccountGuid: r.external_bank_account_guid,
      state: r.state,
      amount: r.amount,
      fee: r.fee,
      estimatedAmount: r.estimated_amount,
      failureCode: r.failure_code,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  private mapTradeResponse(r: CybridTradeResponse): TradeResponse {
    return {
      guid: r.guid,
      quoteGuid: r.quote_guid,
      customerGuid: r.customer_guid,
      side: r.side,
      symbol: r.symbol,
      receiveAmount: r.receive_amount,
      deliverAmount: r.deliver_amount,
      fee: r.fee,
      state: r.state,
      failureCode: r.failure_code,
      createdAt: r.created_at,
    };
  }

  private mapWorkflowResponse(r: CybridWorkflowResponse): WorkflowResponse {
    return {
      guid: r.guid,
      customerGuid: r.customer_guid,
      type: r.type,
      state: r.state,
      plaidLinkToken: r.plaid_link_token,
      externalBankAccountGuid: r.external_bank_account_guid,
      failureCode: r.failure_code,
      createdAt: r.created_at,
    };
  }
}

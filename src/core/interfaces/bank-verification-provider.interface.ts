export interface CreateLinkTokenResponse {
  linkToken: string;
  expiration: string;
}

export interface ExchangePublicTokenRequest {
  publicToken: string;
  userId: string;
}

export interface VerifiedBankAccount {
  accountId: string;
  bankName: string;
  accountName?: string;
  accountNumberMask: string;
  routingNumber: string;
  accountHolderName: string;
  subtype?: string;
  type?: string;
  availableBalance?: number;
  currentBalance?: number;
  institutionName?: string;
}

export interface IBankVerificationProvider {
  createLinkToken(userId: string): Promise<CreateLinkTokenResponse>;
  exchangePublicToken(request: ExchangePublicTokenRequest): Promise<{ accessToken: string; itemId: string; accounts: VerifiedBankAccount[] }>;
  getAccountDetails(accessToken: string, accountId: string): Promise<VerifiedBankAccount>;
}

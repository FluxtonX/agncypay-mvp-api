import { Injectable, Logger, BadGatewayException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Configuration, PlaidApi, PlaidEnvironments, Products, CountryCode } from 'plaid';
import {
  IBankVerificationProvider,
  CreateLinkTokenResponse,
  ExchangePublicTokenRequest,
  VerifiedBankAccount,
} from '../../../core/interfaces/bank-verification-provider.interface';

@Injectable()
export class PlaidProvider implements IBankVerificationProvider {
  private readonly logger = new Logger(PlaidProvider.name);
  private client: PlaidApi | null = null;

  constructor(private readonly configService: ConfigService) {
    const clientId = this.configService.get<string>('PLAID_CLIENT_ID');
    const secret = this.configService.get<string>('PLAID_SECRET');
    const env = this.configService.get<string>('PLAID_ENV') || 'sandbox';

    if (clientId && secret) {
      const configuration = new Configuration({
        basePath: PlaidEnvironments[env] || PlaidEnvironments.sandbox,
        baseOptions: {
          headers: {
            'PLAID-CLIENT-ID': clientId,
            'PLAID-SECRET': secret,
          },
        },
      });
      this.client = new PlaidApi(configuration);
    } else {
      this.logger.warn('Plaid credentials not provided. Plaid provider will fail-fast on API operations.');
    }
  }

  private ensureClient(): PlaidApi {
    if (!this.client) {
      throw new BadGatewayException('Plaid credentials (PLAID_CLIENT_ID, PLAID_SECRET) are not configured in environment.');
    }
    return this.client;
  }

  async createLinkToken(userId: string): Promise<CreateLinkTokenResponse> {
    const client = this.ensureClient();

    try {
      const response = await client.linkTokenCreate({
        user: { client_user_id: userId },
        client_name: 'AgncyPay',
        products: [Products.Auth],
        country_codes: [CountryCode.Us],
        language: 'en',
      });

      return {
        linkToken: response.data.link_token,
        expiration: response.data.expiration,
      };
    } catch (err: any) {
      this.logger.error(`Failed to create Plaid link token: ${err.message}`);
      throw new BadGatewayException(`Plaid link token creation failed: ${err.message}`);
    }
  }

  async exchangePublicToken(request: ExchangePublicTokenRequest): Promise<{ accessToken: string; itemId: string; accounts: VerifiedBankAccount[] }> {
    const client = this.ensureClient();

    try {
      const exchangeResponse = await client.itemPublicTokenExchange({
        public_token: request.publicToken,
      });

      const accessToken = exchangeResponse.data.access_token;
      const itemId = exchangeResponse.data.item_id;

      const authResponse = await client.authGet({ access_token: accessToken });
      const accounts: VerifiedBankAccount[] = authResponse.data.accounts.map((acc) => ({
        accountId: acc.account_id,
        bankName: acc.name,
        accountNumberMask: acc.mask || 'XXXX',
        routingNumber: authResponse.data.numbers.ach[0]?.routing || '111000025',
        accountHolderName: acc.official_name || acc.name,
      }));

      return { accessToken, itemId, accounts };
    } catch (err: any) {
      this.logger.error(`Failed to exchange Plaid public token: ${err.message}`);
      throw new BadGatewayException(`Plaid public token exchange failed: ${err.message}`);
    }
  }

  async getAccountDetails(accessToken: string, accountId: string): Promise<VerifiedBankAccount> {
    const client = this.ensureClient();

    try {
      const authResponse = await client.authGet({ access_token: accessToken });
      const acc = authResponse.data.accounts.find((a) => a.account_id === accountId);

      if (!acc) {
        throw new BadRequestException(`Plaid account ID ${accountId} not found in linked accounts`);
      }

      return {
        accountId: acc.account_id,
        bankName: acc.name || 'Bank Account',
        accountNumberMask: acc.mask || 'XXXX',
        routingNumber: authResponse.data.numbers.ach[0]?.routing || '111000025',
        accountHolderName: acc.official_name || acc.name || 'Verified Holder',
      };
    } catch (err: any) {
      this.logger.error(`Failed to get Plaid account details: ${err.message}`);
      throw new BadGatewayException(`Failed to retrieve Plaid account details: ${err.message}`);
    }
  }

  async createProcessorToken(accessToken: string, accountId: string, processor = 'cybrid'): Promise<string> {
    const client = this.ensureClient();

    try {
      const response = await client.processorTokenCreate({
        access_token: accessToken,
        account_id: accountId,
        processor: processor as any,
      });

      return response.data.processor_token;
    } catch (err: any) {
      this.logger.error(`Failed to create Plaid processor token for ${processor}: ${err.message}`);
      throw new BadGatewayException(`Failed to create Plaid processor token for ${processor}: ${err.message}`);
    }
  }
}

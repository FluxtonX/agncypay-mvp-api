import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import { CybridConfigService } from './cybrid-config.service';
import { CybridErrorResponse, CybridTokenResponse } from './cybrid.types';

/**
 * Cybrid HTTP Client
 *
 * Thin axios wrapper providing:
 * - Bearer token injection from CybridAuthService
 * - Structured request/response logging (secrets redacted)
 * - Exponential backoff on 429 / 5xx
 * - Consistent error extraction
 */
@Injectable()
export class CybridHttpClient {
  private readonly logger = new Logger(CybridHttpClient.name);
  private readonly bankApi: AxiosInstance;
  private readonly idpApi: AxiosInstance;

  private cachedToken: string | null = null;
  private tokenExpiresAt: number = 0;

  private static readonly MAX_RETRIES = 3;
  private static readonly BASE_DELAY_MS = 500;

  constructor(private readonly config: CybridConfigService) {
    this.bankApi = axios.create({
      baseURL: this.config.baseUrl,
      timeout: 30_000,
      headers: { 'Content-Type': 'application/json' },
    });

    this.idpApi = axios.create({
      baseURL: this.config.idpUrl,
      timeout: 15_000,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ─── Authentication ──────────────────────────────────────────

  /**
   * Obtain a bearer token via OAuth2 client_credentials grant.
   * Caches the token and refreshes 60s before expiry.
   */
  async authenticate(): Promise<string> {
    const now = Date.now();

    // Return cached token if still valid (with 60s buffer)
    if (this.cachedToken && this.tokenExpiresAt > now + 60_000) {
      return this.cachedToken;
    }

    if (!this.config.isConfigured) {
      this.logger.warn('Cybrid not configured — returning placeholder token');
      return 'placeholder-token-not-configured';
    }

    try {
      this.logger.log('Requesting new Cybrid bearer token...');

      const response = await this.idpApi.post<CybridTokenResponse>(
        '/oauth/token',
        {
          grant_type: 'client_credentials',
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret,
          scope: 'customers:read customers:execute accounts:read accounts:execute quotes:read quotes:execute trades:read trades:execute transfers:read transfers:execute external_bank_accounts:read external_bank_accounts:execute workflows:read workflows:execute counterparties:read counterparties:execute deposit_bank_accounts:read deposit_bank_accounts:execute identity_verifications:read identity_verifications:execute prices:read banks:read',
        },
      );

      this.cachedToken = response.data.access_token;
      this.tokenExpiresAt = now + response.data.expires_in * 1000;

      this.logger.log(
        `Cybrid token acquired — expires in ${response.data.expires_in}s`,
      );

      return this.cachedToken;
    } catch (error: any) {
      this.logger.error(`Cybrid authentication failed: ${this.extractErrorMessage(error)}`);
      throw new Error(`Cybrid authentication failed: ${this.extractErrorMessage(error)}`);
    }
  }

  // ─── HTTP Methods ────────────────────────────────────────────

  async get<T>(path: string, params?: Record<string, any>): Promise<T> {
    return this.request<T>('GET', path, undefined, params);
  }

  async post<T>(path: string, data?: any): Promise<T> {
    return this.request<T>('POST', path, data);
  }

  async patch<T>(path: string, data?: any): Promise<T> {
    return this.request<T>('PATCH', path, data);
  }

  async delete<T>(path: string): Promise<T> {
    return this.request<T>('DELETE', path);
  }

  // ─── Core Request Handler ────────────────────────────────────

  private async request<T>(
    method: string,
    path: string,
    data?: any,
    params?: Record<string, any>,
    attempt = 1,
  ): Promise<T> {
    const token = await this.authenticate();

    const config: AxiosRequestConfig = {
      method,
      url: path,
      data,
      params,
      headers: {
        Authorization: `Bearer ${token}`,
      },
    };

    // Redacted logging
    this.logger.debug(
      `Cybrid ${method} ${path}` +
        (data ? ` body=${this.redactForLog(data)}` : '') +
        (params ? ` params=${JSON.stringify(params)}` : ''),
    );

    try {
      const response: AxiosResponse<T> = await this.bankApi.request<T>(config);

      this.logger.debug(`Cybrid ${method} ${path} → ${response.status}`);

      return response.data;
    } catch (error: any) {
      const status = error.response?.status;
      const errorMsg = this.extractErrorMessage(error);

      // Retry on 429 (rate limit) or 5xx (server error)
      if (
        (status === 429 || (status >= 500 && status < 600)) &&
        attempt < CybridHttpClient.MAX_RETRIES
      ) {
        const delay = CybridHttpClient.BASE_DELAY_MS * Math.pow(2, attempt - 1);
        this.logger.warn(
          `Cybrid ${method} ${path} → ${status} (attempt ${attempt}/${CybridHttpClient.MAX_RETRIES}). Retrying in ${delay}ms...`,
        );
        await this.sleep(delay);
        return this.request<T>(method, path, data, params, attempt + 1);
      }

      // Token expired — clear cache and retry once
      if (status === 401 && attempt === 1) {
        this.logger.warn('Cybrid token expired — refreshing and retrying...');
        this.cachedToken = null;
        this.tokenExpiresAt = 0;
        return this.request<T>(method, path, data, params, attempt + 1);
      }

      this.logger.error(
        `Cybrid ${method} ${path} failed: ${status} — ${errorMsg}`,
      );

      throw new CybridApiError(
        `Cybrid API error: ${method} ${path} → ${status}: ${errorMsg}`,
        status,
        error.response?.data,
      );
    }
  }

  // ─── Helpers ─────────────────────────────────────────────────

  /**
   * Redact sensitive fields before logging request bodies
   */
  private redactForLog(data: any): string {
    if (!data || typeof data !== 'object') return String(data);

    const redacted = { ...data };
    const sensitiveKeys = [
      'client_secret',
      'access_token',
      'plaid_processor_token',
      'account_number',
      'identification_value',
    ];

    for (const key of sensitiveKeys) {
      if (key in redacted) {
        redacted[key] = '***REDACTED***';
      }
    }

    return JSON.stringify(redacted);
  }

  private extractErrorMessage(error: any): string {
    if (error.response?.data) {
      const errData = error.response.data as CybridErrorResponse;
      return errData.error_message || errData.message_code || JSON.stringify(errData);
    }
    return error.message || 'Unknown error';
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Custom error class for Cybrid API errors.
 * Preserves the HTTP status and raw Cybrid error response.
 */
export class CybridApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number | undefined,
    public readonly rawResponse: any,
  ) {
    super(message);
    this.name = 'CybridApiError';
  }
}

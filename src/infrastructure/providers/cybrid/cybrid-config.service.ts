import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Cybrid Configuration Service
 *
 * Reads and validates Cybrid configuration from environment variables.
 * Provides typed accessors for all Cybrid-related config.
 */
@Injectable()
export class CybridConfigService {
  private readonly logger = new Logger(CybridConfigService.name);

  readonly clientId: string;
  readonly clientSecret: string;
  readonly bankGuid: string;
  readonly baseUrl: string;
  readonly idpUrl: string;
  readonly environment: string;
  readonly webhookSecret: string;

  constructor(private readonly configService: ConfigService) {
    this.clientId = this.configService.get<string>('CYBRID_CLIENT_ID', '');
    this.clientSecret = this.configService.get<string>('CYBRID_CLIENT_SECRET', '');
    this.bankGuid = this.configService.get<string>('CYBRID_BANK_GUID', '');
    this.baseUrl = this.configService.get<string>(
      'CYBRID_BASE_URL',
      'https://bank.sandbox.cybrid.app',
    );
    this.idpUrl = this.configService.get<string>(
      'CYBRID_IDP_URL',
      'https://id.sandbox.cybrid.app',
    );
    this.environment = this.configService.get<string>('CYBRID_ENVIRONMENT', 'sandbox');
    this.webhookSecret = this.configService.get<string>('CYBRID_WEBHOOK_SECRET', '');

    this.validateConfig();
  }

  private validateConfig(): void {
    const missing: string[] = [];

    if (!this.clientId) missing.push('CYBRID_CLIENT_ID');
    if (!this.clientSecret) missing.push('CYBRID_CLIENT_SECRET');
    if (!this.bankGuid) missing.push('CYBRID_BANK_GUID');

    if (missing.length > 0) {
      this.logger.warn(
        `Cybrid configuration incomplete — missing: ${missing.join(', ')}. ` +
          `Provider will operate in placeholder mode until credentials are supplied.`,
      );
    } else {
      this.logger.log(`Cybrid configured for environment: ${this.environment}`);
    }
  }

  get isConfigured(): boolean {
    return !!(this.clientId && this.clientSecret && this.bankGuid);
  }

  get isSandbox(): boolean {
    return this.environment === 'sandbox';
  }
}

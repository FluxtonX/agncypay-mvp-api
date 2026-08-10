import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OAuthClient from 'intuit-oauth';
import { QuickBooksConnectionRepository } from './repositories/quickbooks-connection.repository';
import { QuickBooksConnectStatus } from '@prisma/client';

@Injectable()
export class QuickBooksOAuthService {
  private readonly logger = new Logger(QuickBooksOAuthService.name);
  private oauthClient: OAuthClient | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly connectionRepo: QuickBooksConnectionRepository,
  ) {
    const clientId = this.configService.get<string>('QUICKBOOKS_CLIENT_ID');
    const clientSecret = this.configService.get<string>('QUICKBOOKS_CLIENT_SECRET');
    const redirectUri = this.configService.get<string>('QUICKBOOKS_REDIRECT_URI') || 'http://localhost:3001/api/v1/quickbooks/callback';
    const environment = (this.configService.get<string>('QUICKBOOKS_ENVIRONMENT') || 'sandbox') as any;

    if (clientId && clientSecret) {
      this.oauthClient = new OAuthClient({
        clientId,
        clientSecret,
        environment,
        redirectUri,
      });
    } else {
      this.logger.warn('QuickBooks credentials missing. Client running in simulated mode.');
    }
  }

  getAuthUrl(agencyId: string): string {
    if (!this.oauthClient) {
      const frontendUrl = this.configService.get<string>('FRONTEND_URL') || 'http://localhost:3000';
      return `${frontendUrl}/agencydashboard/invoices?qb_connected=true&simulated=true`;
    }

    return this.oauthClient.authorizeUri({
      scope: [OAuthClient.scopes.Accounting, OAuthClient.scopes.OpenId],
      state: `agency_${agencyId}`,
    });
  }

  async handleCallback(code: string, realmId: string, state: string): Promise<string> {
    const agencyId = state ? state.replace('agency_', '') : '';

    if (!this.oauthClient || !agencyId) {
      if (agencyId) {
        await this.connectionRepo.upsertConnection({
          agencyId,
          realmId: realmId || '91303502849201',
          accessToken: `simulated-access-token-${Date.now()}`,
          refreshToken: `simulated-refresh-token-${Date.now()}`,
          tokenExpiry: new Date(Date.now() + 3600 * 1000),
          status: QuickBooksConnectStatus.connected,
        });
      }
      return `${this.configService.get<string>('FRONTEND_URL') || 'http://localhost:3000'}/agencydashboard/invoices?qb_connected=true`;
    }

    try {
      const authResponse = await this.oauthClient.createToken(code);
      const token = authResponse.getJson();

      const accessToken = token.access_token;
      const refreshToken = token.refresh_token;
      const expiresIn = token.expires_in || 3600;
      const tokenExpiry = new Date(Date.now() + expiresIn * 1000);

      await this.connectionRepo.upsertConnection({
        agencyId,
        realmId,
        accessToken,
        refreshToken,
        tokenExpiry,
        status: QuickBooksConnectStatus.connected,
      });

      return `${this.configService.get<string>('FRONTEND_URL') || 'http://localhost:3000'}/agencydashboard/invoices?qb_connected=true`;
    } catch (err: any) {
      this.logger.error(`QuickBooks OAuth token exchange error: ${err.message}`);
      if (agencyId) {
        await this.connectionRepo.updateStatus(agencyId, QuickBooksConnectStatus.sync_failed, err.message);
      }
      return `${this.configService.get<string>('FRONTEND_URL') || 'http://localhost:3000'}/agencydashboard/invoices?qb_error=${encodeURIComponent(err.message)}`;
    }
  }

  async getValidAccessToken(agencyId: string): Promise<{ accessToken: string; realmId: string }> {
    const conn = await this.connectionRepo.findByAgencyId(agencyId);
    if (!conn || !conn.realmId) {
      throw new UnauthorizedException('No QuickBooks connection found for this agency');
    }

    if (conn.status === QuickBooksConnectStatus.disconnected) {
      throw new UnauthorizedException('QuickBooks is disconnected for this agency');
    }

    // Auto-refresh token if expired or about to expire in 5 mins
    const isExpired = !conn.tokenExpiry || conn.tokenExpiry.getTime() - Date.now() < 300 * 1000;

    if (isExpired && this.oauthClient && conn.refreshToken && !conn.refreshToken.includes('simulated')) {
      try {
        this.logger.log(`Refreshing QuickBooks access token for agency ${agencyId}...`);
        const authResponse = await this.oauthClient.refreshUsingToken(conn.refreshToken);
        const token = authResponse.getJson();

        const newAccessToken = token.access_token;
        const newRefreshToken = token.refresh_token || conn.refreshToken;
        const tokenExpiry = new Date(Date.now() + (token.expires_in || 3600) * 1000);

        const updated = await this.connectionRepo.upsertConnection({
          agencyId,
          realmId: conn.realmId,
          accessToken: newAccessToken,
          refreshToken: newRefreshToken,
          tokenExpiry,
          status: QuickBooksConnectStatus.connected,
        });

        return { accessToken: updated.accessToken, realmId: conn.realmId };
      } catch (err: any) {
        this.logger.error(`Failed to refresh QuickBooks token: ${err.message}`);
        await this.connectionRepo.updateStatus(agencyId, QuickBooksConnectStatus.reconnect_required, err.message);
        throw new UnauthorizedException('QuickBooks authentication expired. Please reconnect your account.');
      }
    }

    return { accessToken: conn.accessToken, realmId: conn.realmId };
  }
}

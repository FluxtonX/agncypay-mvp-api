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

  getAuthUrl(agencyId: string, returnTo = '/branddashboard'): string {
    if (!this.oauthClient) {
      const frontendUrl = this.configService.get<string>('FRONTEND_URL') || 'http://localhost:3000';
      return `${frontendUrl}${returnTo}?qb_connected=true&simulated=true`;
    }

    // State encodes user/agency identifier and return path
    const safeState = Buffer.from(JSON.stringify({ agencyId, returnTo })).toString('base64url');

    return this.oauthClient.authorizeUri({
      scope: [OAuthClient.scopes.Accounting, OAuthClient.scopes.OpenId],
      state: safeState,
    });
  }

  async handleCallback(code: string, realmId: string, state: string, rawUrl?: string): Promise<string> {
    const frontendUrl = this.configService.get<string>('FRONTEND_URL') || 'http://localhost:3000';
    let agencyId = '';
    let returnTo = '/branddashboard';

    if (state) {
      try {
        if (state.startsWith('agency_')) {
          agencyId = state.replace('agency_', '');
        } else {
          const parsed = JSON.parse(Buffer.from(state, 'base64url').toString('utf-8'));
          agencyId = parsed.agencyId || '';
          returnTo = parsed.returnTo || '/branddashboard';
        }
      } catch {
        agencyId = state;
      }
    }

    if (!this.oauthClient || !code) {
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
      return `${frontendUrl}${returnTo}?qb_connected=true`;
    }

    try {
      // intuit-oauth expects the full callback URI or query string (e.g. ?code=...&realmId=...&state=...)
      const exchangeUri = rawUrl || `?code=${encodeURIComponent(code)}&realmId=${encodeURIComponent(realmId || '')}&state=${encodeURIComponent(state || '')}`;
      const authResponse = await this.oauthClient.createToken(exchangeUri);
      const token = authResponse.getJson();

      const accessToken = token.access_token;
      const refreshToken = token.refresh_token;
      const expiresIn = token.expires_in || 3600;
      const tokenExpiry = new Date(Date.now() + expiresIn * 1000);

      await this.connectionRepo.upsertConnection({
        agencyId: agencyId || 'default-brand',
        realmId,
        accessToken,
        refreshToken,
        tokenExpiry,
        status: QuickBooksConnectStatus.connected,
      });

      return `${frontendUrl}${returnTo}?qb_connected=true`;
    } catch (err: any) {
      this.logger.error(`QuickBooks OAuth token exchange error: ${err.message}`);
      if (agencyId) {
        try {
          await this.connectionRepo.updateStatus(agencyId, QuickBooksConnectStatus.sync_failed, err.message);
        } catch (_) {}
      }
      const friendlyError = err.message?.includes('redirect_uri')
        ? 'Redirect URI mismatch with Intuit Developer Portal'
        : (err.message || 'Authorization failed');
      return `${frontendUrl}${returnTo}?qb_error=${encodeURIComponent(friendlyError)}`;
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

        return { accessToken: updated?.accessToken || newAccessToken, realmId: conn.realmId };
      } catch (err: any) {
        this.logger.error(`Failed to refresh QuickBooks token: ${err.message}`);
        await this.connectionRepo.updateStatus(agencyId, QuickBooksConnectStatus.reconnect_required, err.message);
        throw new UnauthorizedException('QuickBooks authentication expired. Please reconnect your account.');
      }
    }

    return { accessToken: conn.accessToken, realmId: conn.realmId };
  }
}

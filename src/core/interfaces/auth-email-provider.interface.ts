export const AUTH_EMAIL_PROVIDER = Symbol('AUTH_EMAIL_PROVIDER');

export type AuthEmailPurpose = 'verify_email' | 'password_reset' | 'invitation';

export interface AuthEmailMessage {
  to: string;
  purpose: AuthEmailPurpose;
  token: string;
  expiresAt: Date;
  metadata?: Record<string, unknown>;
}

export interface AuthEmailDelivery {
  id: string;
  mode: 'capture' | 'email';
}

export interface AuthEmailProvider {
  send(message: AuthEmailMessage): Promise<AuthEmailDelivery>;
}

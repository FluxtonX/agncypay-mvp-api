import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2';
import {
  AuthEmailDelivery,
  AuthEmailMessage,
  AuthEmailProvider,
} from '../../../core/interfaces/auth-email-provider.interface';

type EmailContent = {
  subject: string;
  text: string;
  html: string;
};

@Injectable()
export class SesAuthEmailProvider implements AuthEmailProvider {
  private readonly client: SESv2Client;

  constructor(private readonly configService: ConfigService) {
    this.client = new SESv2Client({
      region: this.configService.get<string>('AWS_REGION') || 'us-east-1',
    });
  }

  async send(message: AuthEmailMessage): Promise<AuthEmailDelivery> {
    const from = this.requiredConfiguration('AUTH_EMAIL_FROM');
    const content = this.contentFor(message);
    const replyTo = this.configService
      .get<string>('AUTH_EMAIL_REPLY_TO')
      ?.trim();

    const result = await this.client.send(
      new SendEmailCommand({
        FromEmailAddress: from,
        Destination: { ToAddresses: [message.to] },
        ReplyToAddresses: replyTo ? [replyTo] : undefined,
        Content: {
          Simple: {
            Subject: { Charset: 'UTF-8', Data: content.subject },
            Body: {
              Text: { Charset: 'UTF-8', Data: content.text },
              Html: { Charset: 'UTF-8', Data: content.html },
            },
          },
        },
      }),
    );

    if (!result.MessageId) {
      throw new Error('Amazon SES accepted no message identifier');
    }
    return { id: result.MessageId, mode: 'email' };
  }

  private contentFor(message: AuthEmailMessage): EmailContent {
    const frontendUrl = this.requiredConfiguration('FRONTEND_URL');
    const routeByPurpose: Record<AuthEmailMessage['purpose'], string> = {
      verify_email: '/verify-email',
      password_reset: '/reset-password',
      invitation: '/accept-invitation',
    };
    const actionByPurpose: Record<AuthEmailMessage['purpose'], string> = {
      verify_email: 'Verify your AgncyPay email',
      password_reset: 'Reset your AgncyPay password',
      invitation: 'Accept your AgncyPay invitation',
    };
    const descriptionByPurpose: Record<AuthEmailMessage['purpose'], string> = {
      verify_email:
        'Verify your email address to activate your AgncyPay account.',
      password_reset: 'Use this secure link to choose a new AgncyPay password.',
      invitation: 'Use this secure link to accept your AgncyPay invitation.',
    };

    const link = new URL(routeByPurpose[message.purpose], frontendUrl);
    link.searchParams.set('token', message.token);
    const expiresAt = message.expiresAt.toISOString();
    const action = actionByPurpose[message.purpose];
    const description = descriptionByPurpose[message.purpose];
    const safeLink = this.escapeHtml(link.toString());

    return {
      subject: action,
      text: `${description}\n\n${link.toString()}\n\nThis link expires at ${expiresAt}. If you did not request this message, you can ignore it.`,
      html: [
        '<!doctype html><html><body>',
        `<h1>${this.escapeHtml(action)}</h1>`,
        `<p>${this.escapeHtml(description)}</p>`,
        `<p><a href="${safeLink}">${this.escapeHtml(action)}</a></p>`,
        `<p>This link expires at ${this.escapeHtml(expiresAt)}.</p>`,
        '<p>If you did not request this message, you can ignore it.</p>',
        '</body></html>',
      ].join(''),
    };
  }

  private requiredConfiguration(name: string): string {
    const value = this.configService.get<string>(name)?.trim();
    if (!value) throw new Error(`${name} is required for SES email delivery`);
    return value;
  }

  private escapeHtml(value: string): string {
    return value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }
}

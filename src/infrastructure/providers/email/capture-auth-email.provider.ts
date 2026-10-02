import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import {
  AuthEmailDelivery,
  AuthEmailMessage,
  AuthEmailProvider,
} from '../../../core/interfaces/auth-email-provider.interface';

@Injectable()
export class CaptureAuthEmailProvider implements AuthEmailProvider {
  private readonly logger = new Logger(CaptureAuthEmailProvider.name);
  private readonly messages = new Map<string, AuthEmailMessage>();

  send(message: AuthEmailMessage): Promise<AuthEmailDelivery> {
    const id = crypto.randomUUID();
    this.messages.set(id, structuredClone(message));
    this.logger.log(
      `Captured ${message.purpose} email for ${message.to}; deliveryId=${id}`,
    );
    return Promise.resolve({ id, mode: 'capture' });
  }

  get(id: string): AuthEmailMessage | undefined {
    const message = this.messages.get(id);
    return message ? structuredClone(message) : undefined;
  }

  findLatest(to: string, purpose: AuthEmailMessage['purpose']) {
    const normalizedEmail = to.trim().toLowerCase();
    const message = [...this.messages.values()]
      .reverse()
      .find(
        (message) =>
          message.to.trim().toLowerCase() === normalizedEmail &&
          message.purpose === purpose,
      );
    return message ? structuredClone(message) : undefined;
  }

  clear(): void {
    this.messages.clear();
  }
}

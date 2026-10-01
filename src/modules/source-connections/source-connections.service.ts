import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { decryptText, encryptText } from '../../common/utils/crypto.util';

type ConnectionCredentials = Record<string, unknown>;

@Injectable()
export class SourceConnectionsService {
  constructor(private readonly prisma: PrismaService) {}

  private digest(value: string): string {
    return crypto.createHash('sha256').update(value).digest('hex');
  }

  private canonicalJson(value: unknown): string {
    if (Array.isArray(value)) {
      return `[${value.map((item) => this.canonicalJson(item)).join(',')}]`;
    }
    if (value && typeof value === 'object') {
      const entries = Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(
          ([key, item]) => `${JSON.stringify(key)}:${this.canonicalJson(item)}`,
        );
      return `{${entries.join(',')}}`;
    }
    return JSON.stringify(value);
  }

  async getAgencyOrganization(userId: string) {
    const organization = await this.prisma.organization.findFirst({
      where: {
        type: 'agency',
        status: 'active',
        participants: {
          some: {
            status: 'active',
            participant: { users: { some: { userId } } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    if (!organization) {
      throw new ForbiddenException(
        'Active Agency organization membership is required',
      );
    }
    return organization;
  }

  async upsertOrganizationConnection(input: {
    userId: string;
    connectorKey: string;
    externalTenantId: string;
    displayName?: string;
    credentials?: ConnectionCredentials;
    status?: 'pending' | 'active' | 'expired' | 'disconnected' | 'error';
    metadata?: Record<string, unknown>;
  }) {
    const organization = await this.getAgencyOrganization(input.userId);
    const existing = await this.prisma.sourceConnection.findFirst({
      where: {
        organizationId: organization.id,
        connectorKey: input.connectorKey,
        externalTenantId: input.externalTenantId,
        deletedAt: null,
      },
    });
    const data = {
      displayName: input.displayName || input.connectorKey,
      status: input.status || ('active' as const),
      credentialsEncrypted: input.credentials
        ? encryptText(JSON.stringify(input.credentials))
        : existing?.credentialsEncrypted || '',
      metadata: (input.metadata || {}) as any,
      lastError: null,
    };
    if (existing) {
      return this.prisma.sourceConnection.update({
        where: { id: existing.id },
        data,
      });
    }
    return this.prisma.sourceConnection.create({
      data: {
        organizationId: organization.id,
        connectorKey: input.connectorKey,
        externalTenantId: input.externalTenantId,
        ...data,
      },
    });
  }

  readCredentials(connection: {
    credentialsEncrypted: string;
  }): ConnectionCredentials {
    if (!connection.credentialsEncrypted) return {};
    return JSON.parse(decryptText(connection.credentialsEncrypted));
  }

  async listOrganizationConnections(userId: string) {
    const organization = await this.getAgencyOrganization(userId);
    return this.prisma.sourceConnection.findMany({
      where: { organizationId: organization.id, deletedAt: null },
      select: {
        id: true,
        connectorKey: true,
        externalTenantId: true,
        displayName: true,
        status: true,
        syncCursor: true,
        lastSyncedAt: true,
        lastError: true,
        metadata: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async createCrmWebhookConnection(
    userId: string,
    displayName = 'Generic CRM Webhook',
  ) {
    const organization = await this.getAgencyOrganization(userId);
    const secret = crypto.randomBytes(32).toString('base64url');
    const connection = await this.prisma.sourceConnection.create({
      data: {
        organizationId: organization.id,
        connectorKey: 'generic_crm',
        externalTenantId: crypto.randomUUID(),
        displayName,
        status: 'active',
        webhookSecretHash: this.digest(secret),
      },
    });
    return {
      connection,
      apiKey: `agncy_crm_${connection.id}.${secret}`,
    };
  }

  async issueOAuthState(
    userId: string,
    connectorKey: string,
    returnTo = '/agencydashboard/integrations',
  ) {
    const organization = await this.getAgencyOrganization(userId);
    const safeReturnTo =
      returnTo.startsWith('/') && !returnTo.startsWith('//')
        ? returnTo
        : '/agencydashboard/integrations';
    const secret = crypto.randomBytes(32).toString('base64url');
    const record = await this.prisma.integrationOAuthState.create({
      data: {
        stateHash: this.digest(secret),
        connectorKey,
        organizationId: organization.id,
        createdById: userId,
        returnTo: safeReturnTo,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      },
    });
    return `${record.id}.${secret}`;
  }

  async consumeOAuthState(state: string, connectorKey: string) {
    const match = /^([^\.]+)\.(.+)$/.exec(state || '');
    if (!match) throw new UnauthorizedException('Invalid OAuth state');
    const [, id, secret] = match;
    const record = await this.prisma.integrationOAuthState.findUnique({
      where: { id },
    });
    if (
      !record ||
      record.connectorKey !== connectorKey ||
      record.consumedAt ||
      record.expiresAt <= new Date()
    ) {
      throw new UnauthorizedException(
        'OAuth state is invalid, expired, or already used',
      );
    }
    const expected = Buffer.from(record.stateHash, 'hex');
    const received = Buffer.from(this.digest(secret), 'hex');
    if (
      expected.length !== received.length ||
      !crypto.timingSafeEqual(expected, received)
    ) {
      throw new UnauthorizedException('Invalid OAuth state');
    }
    const consumed = await this.prisma.integrationOAuthState.updateMany({
      where: { id, consumedAt: null, expiresAt: { gt: new Date() } },
      data: { consumedAt: new Date() },
    });
    if (consumed.count !== 1) {
      throw new UnauthorizedException('OAuth state was already consumed');
    }
    return record;
  }

  async rotateCrmWebhookSecret(userId: string, connectionId: string) {
    const organization = await this.getAgencyOrganization(userId);
    const connection = await this.prisma.sourceConnection.findFirst({
      where: {
        id: connectionId,
        organizationId: organization.id,
        connectorKey: 'generic_crm',
        deletedAt: null,
      },
    });
    if (!connection) throw new NotFoundException('CRM connection not found');
    const secret = crypto.randomBytes(32).toString('base64url');
    await this.prisma.sourceConnection.update({
      where: { id: connection.id },
      data: { webhookSecretHash: this.digest(secret), status: 'active' },
    });
    return { apiKey: `agncy_crm_${connection.id}.${secret}` };
  }

  async authenticateCrmApiKey(apiKey: string) {
    const match = /^agncy_crm_([^\.]+)\.(.+)$/.exec(apiKey || '');
    if (!match) throw new UnauthorizedException('Invalid CRM webhook API key');
    const [, connectionId, secret] = match;
    const connection = await this.prisma.sourceConnection.findFirst({
      where: {
        id: connectionId,
        connectorKey: 'generic_crm',
        status: 'active',
        deletedAt: null,
      },
      include: { organization: true },
    });
    if (!connection?.webhookSecretHash || !connection.organizationId) {
      throw new UnauthorizedException('CRM webhook connection is unavailable');
    }
    const expected = Buffer.from(connection.webhookSecretHash, 'hex');
    const received = Buffer.from(this.digest(secret), 'hex');
    if (
      expected.length !== received.length ||
      !crypto.timingSafeEqual(expected, received)
    ) {
      throw new UnauthorizedException('Invalid CRM webhook API key');
    }
    return connection;
  }

  async receiveEvent(input: {
    connectionId: string;
    externalEventId: string;
    eventType: string;
    payload: Record<string, unknown>;
    occurredAt?: Date;
  }) {
    const payloadHash = this.digest(this.canonicalJson(input.payload));
    const existing = await this.prisma.sourceEvent.findUnique({
      where: {
        connectionId_externalEventId: {
          connectionId: input.connectionId,
          externalEventId: input.externalEventId,
        },
      },
    });
    if (existing) {
      if (existing.payloadHash !== payloadHash) {
        throw new ConflictException(
          'Event ID was reused with a different payload',
        );
      }
      return { event: existing, duplicate: true };
    }
    try {
      const event = await this.prisma.sourceEvent.create({
        data: {
          connectionId: input.connectionId,
          externalEventId: input.externalEventId,
          eventType: input.eventType,
          payloadHash,
          payload: input.payload as any,
          occurredAt: input.occurredAt,
        },
      });
      return { event, duplicate: false };
    } catch (error: any) {
      if (error?.code !== 'P2002') throw error;
      const event = await this.prisma.sourceEvent.findUniqueOrThrow({
        where: {
          connectionId_externalEventId: {
            connectionId: input.connectionId,
            externalEventId: input.externalEventId,
          },
        },
      });
      if (event.payloadHash !== payloadHash) {
        throw new ConflictException(
          'Event ID was reused with a different payload',
        );
      }
      return { event, duplicate: true };
    }
  }

  async markEventProcessing(eventId: string) {
    const claimed = await this.prisma.sourceEvent.updateMany({
      where: { id: eventId, status: { in: ['received', 'failed'] } },
      data: { status: 'processing', attempts: { increment: 1 }, error: null },
    });
    return claimed.count === 1;
  }

  async markEventProcessed(eventId: string, ignored = false) {
    return this.prisma.sourceEvent.update({
      where: { id: eventId },
      data: {
        status: ignored ? 'ignored' : 'processed',
        processedAt: new Date(),
        error: null,
      },
    });
  }

  async markEventFailed(eventId: string, error: unknown) {
    return this.prisma.sourceEvent.update({
      where: { id: eventId },
      data: {
        status: 'failed',
        error:
          error instanceof Error
            ? error.message.slice(0, 2000)
            : String(error).slice(0, 2000),
      },
    });
  }
}

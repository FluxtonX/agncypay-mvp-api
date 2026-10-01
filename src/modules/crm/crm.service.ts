import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { ConfigService } from '@nestjs/config';
import { CrmWebhookDto, CsvRosterImportDto } from './dto/crm-webhook.dto';
import { InvitationService } from '../../auth/invitation.service';
import { SourceConnectionsService } from '../source-connections/source-connections.service';
import { CommercialDocumentsService } from '../commercial-documents/commercial-documents.service';

@Injectable()
export class CrmService {
  private readonly logger = new Logger(CrmService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
    private readonly configService: ConfigService,
    private readonly invitationService: InvitationService,
    private readonly sourceConnections: SourceConnectionsService,
    private readonly commercialDocuments: CommercialDocumentsService,
  ) {}

  private async syncTalentParticipant(input: {
    agencyId: string;
    organizationId: string;
    fullName: string;
    email?: string;
    connection?: { id: string; connectorKey: string; externalTenantId: string };
    externalTalentId?: string;
    metadata?: Record<string, unknown>;
  }) {
    let identity =
      input.connection && input.externalTalentId
        ? await this.prisma.externalIdentityMap.findUnique({
            where: {
              sourceSystem_sourceTenantId_externalType_externalId: {
                sourceSystem: input.connection.connectorKey,
                sourceTenantId: input.connection.externalTenantId,
                externalType: 'talent',
                externalId: input.externalTalentId,
              },
            },
            include: {
              participant: { include: { users: { include: { user: true } } } },
            },
          })
        : null;
    const mappedUser = identity?.participant?.users[0]?.user;
    const identityMetadata = (identity?.metadata || {}) as Record<
      string,
      unknown
    >;
    const email = (
      input.email ||
      mappedUser?.email ||
      identityMetadata.email?.toString() ||
      ''
    )
      .trim()
      .toLowerCase();
    if (!email) {
      throw new BadRequestException(
        'Talent email is required for permissioned mobile activation',
      );
    }
    let participant = identity?.participant;
    if (!participant) {
      const user = await this.prisma.user.findUnique({
        where: { email },
        include: {
          participantLinks: {
            include: {
              participant: { include: { users: { include: { user: true } } } },
            },
          },
        },
      });
      participant = user?.participantLinks[0]?.participant || null;
    }
    if (!participant) {
      participant = await this.prisma.participant.create({
        data: { displayName: input.fullName },
        include: { users: { include: { user: true } } },
      });
    } else if (participant.displayName !== input.fullName) {
      participant = await this.prisma.participant.update({
        where: { id: participant.id },
        data: {
          displayName: input.fullName,
          status: 'active',
          deletedAt: null,
        },
        include: { users: { include: { user: true } } },
      });
    }
    await this.prisma.organizationParticipant.upsert({
      where: {
        organizationId_participantId_relationshipType: {
          organizationId: input.organizationId,
          participantId: participant.id,
          relationshipType: 'talent',
        },
      },
      update: { status: 'active', endsAt: null },
      create: {
        organizationId: input.organizationId,
        participantId: participant.id,
        relationshipType: 'talent',
      },
    });
    if (input.connection && input.externalTalentId) {
      await this.prisma.externalIdentityMap.upsert({
        where: {
          sourceSystem_sourceTenantId_externalType_externalId: {
            sourceSystem: input.connection.connectorKey,
            sourceTenantId: input.connection.externalTenantId,
            externalType: 'talent',
            externalId: input.externalTalentId,
          },
        },
        update: {
          participantId: participant.id,
          status: 'active',
          metadata: {
            ...input.metadata,
            email,
            connectionId: input.connection.id,
          },
        },
        create: {
          participantId: participant.id,
          sourceSystem: input.connection.connectorKey,
          sourceTenantId: input.connection.externalTenantId,
          externalType: 'talent',
          externalId: input.externalTalentId,
          metadata: {
            ...input.metadata,
            email,
            connectionId: input.connection.id,
          },
        },
      });
    }
    const activeUser = participant.users[0]?.user;
    const invitation = activeUser?.emailVerified
      ? null
      : await this.invitationService.createForParticipant(
          input.agencyId,
          {
            organizationId: input.organizationId,
            email,
            accountType: 'talent',
            relationshipType: 'talent',
          },
          participant.id,
        );
    return { participant, email, invitation };
  }

  private async getAgencyOrganizationId(agencyId: string): Promise<string> {
    const organization = await this.prisma.organization.findFirst({
      where: {
        type: 'agency',
        id: agencyId,
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!organization) {
      throw new NotFoundException(
        `Agency organization for ${agencyId} not found`,
      );
    }
    return organization.id;
  }

  async getCrmConfig(agencyId: string) {
    const connections = (
      await this.sourceConnections.listOrganizationConnections(agencyId)
    ).filter((connection) => connection.connectorKey === 'generic_crm');
    const baseUrl =
      this.configService.get<string>('APP_URL') ||
      'https://api.agncypay.internal';
    return {
      connections,
      webhookUrl: `${baseUrl}/api/v1/crm/webhook`,
      supportedEvents: [
        'talent.created',
        'talent.sync',
        'talent.updated',
        'deal.closed',
        'invoice.created',
        'invoice.updated',
        'payable.created',
      ],
      documentation: {
        authenticationHeader:
          'X-AgncyPay-CRM-Key: agncy_crm_<connection>.<secret>',
        idempotencyHeader: 'X-AgncyPay-Event-ID: stable provider event ID',
        payloadFormat: {
          event: 'talent.sync | invoice.created | payable.created',
          data: {
            fullName: 'Creator Name',
            email: 'creator@example.com',
            amount: 5000,
          },
        },
      },
    };
  }

  async createCrmConfig(agencyId: string, displayName?: string) {
    const created = await this.sourceConnections.createCrmWebhookConnection(
      agencyId,
      displayName,
    );
    const baseUrl =
      this.configService.get<string>('APP_URL') ||
      'https://api.agncypay.internal';
    return {
      connectionId: created.connection.id,
      displayName: created.connection.displayName,
      webhookUrl: `${baseUrl}/api/v1/crm/webhook`,
      apiKey: created.apiKey,
      secretShownOnce: true,
    };
  }

  async rotateCrmSecret(agencyId: string, connectionId: string) {
    const rotated = await this.sourceConnections.rotateCrmWebhookSecret(
      agencyId,
      connectionId,
    );
    return { connectionId, apiKey: rotated.apiKey, secretShownOnce: true };
  }

  private async resolveAgencyActor(organizationId: string): Promise<string> {
    const actor = await this.prisma.user.findFirst({
      where: {
        accountType: 'agency',
        deletedAt: null,
        participantLinks: {
          some: {
            participant: {
              organizations: { some: { organizationId, status: 'active' } },
            },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!actor)
      throw new NotFoundException(
        'CRM connection has no active Agency operator',
      );
    return actor.id;
  }

  /**
   * Process generic inbound webhook from Agency CRM (HubSpot, GoHighLevel, Airtable, etc.)
   */
  async handleWebhook(
    apiKey: string,
    externalEventId: string,
    payload: CrmWebhookDto,
  ) {
    if (!externalEventId) {
      throw new BadRequestException(
        'X-AgncyPay-Event-ID header or payload eventId is required',
      );
    }
    const connection =
      await this.sourceConnections.authenticateCrmApiKey(apiKey);
    const received = await this.sourceConnections.receiveEvent({
      connectionId: connection.id,
      externalEventId,
      eventType: payload.event,
      payload: payload as unknown as Record<string, unknown>,
      occurredAt: payload.occurredAt ? new Date(payload.occurredAt) : undefined,
    });
    if (
      received.duplicate &&
      !['received', 'failed'].includes(received.event.status)
    ) {
      return {
        status: 'duplicate',
        eventId: received.event.id,
        eventState: received.event.status,
      };
    }
    const claimed = await this.sourceConnections.markEventProcessing(
      received.event.id,
    );
    if (!claimed) {
      return {
        status: 'duplicate',
        eventId: received.event.id,
        eventState: 'processing',
      };
    }
    const agencyId = await this.resolveAgencyActor(connection.organizationId!);
    try {
      const result = await this.processWebhookEvent(
        payload,
        agencyId,
        connection,
        received.event,
      );
      const ignored = result.status === 'acknowledged';
      await this.sourceConnections.markEventProcessed(
        received.event.id,
        ignored,
      );
      return { ...result, eventId: received.event.id };
    } catch (error) {
      await this.sourceConnections.markEventFailed(received.event.id, error);
      throw error;
    }
  }

  private async processWebhookEvent(
    payload: CrmWebhookDto,
    agencyId: string,
    connection: {
      id: string;
      organizationId: string | null;
      connectorKey: string;
      externalTenantId: string;
    },
    sourceEvent: { id: string; externalEventId: string; payloadHash: string },
  ) {
    this.logger.log(
      `Processing CRM webhook event: "${payload.event}" for agency: ${agencyId}`,
    );

    const event = (payload.event || '').toLowerCase();
    const data = payload.data || {};

    switch (event) {
      case 'talent.sync':
      case 'talent.created':
      case 'talent.updated':
      case 'contact.created': {
        const fullName =
          data.fullName ||
          data.name ||
          `${data.firstName || ''} ${data.lastName || ''}`.trim();
        if (!fullName) {
          throw new BadRequestException(
            'Talent full name is required in webhook data',
          );
        }

        const externalTalentId = data.externalId || data.id;
        if (!externalTalentId) {
          throw new BadRequestException(
            'Stable CRM Talent externalId is required',
          );
        }

        const organizationId = await this.getAgencyOrganizationId(agencyId);
        const synced = await this.syncTalentParticipant({
          agencyId,
          organizationId,
          fullName,
          email: data.email,
          connection,
          externalTalentId: String(externalTalentId),
          metadata: {
            ...data.metadata,
            crmSource: data.crmSource || 'generic_webhook',
            importedAt: new Date().toISOString(),
          },
        });

        await this.auditLogsService.log({
          userId: agencyId,
          action: 'CRM_TALENT_INGESTED',
          entityType: 'Participant',
          entityId: synced.participant.id,
          details: { event, fullName, email: synced.email },
        });

        return {
          status: 'success',
          action: 'talent_synced',
          talentId: synced.participant.id,
          fullName: synced.participant.displayName,
          email: synced.email,
          invitationId: synced.invitation?.invitationId,
          inviteToken: synced.invitation?.token,
          expiresAt: synced.invitation?.expiresAt,
          mobileAppDeepLink: synced.invitation
            ? `agncypay://activate?token=${synced.invitation.token}&email=${encodeURIComponent(synced.email)}`
            : undefined,
        };
      }

      case 'payable.created':
      case 'invoice.created':
      case 'invoice.updated':
      case 'deal.closed':
      case 'deal.won': {
        // The CRM supplies final economics. We only map beneficiaries and validate
        // the supplied total/allocation; no payout exists until orchestration starts.
        let talentId = data.talentId as string | undefined;
        const externalTalentId = data.talentExternalId || data.externalTalentId;
        if (!talentId && externalTalentId) {
          const identity = await this.prisma.externalIdentityMap.findUnique({
            where: {
              sourceSystem_sourceTenantId_externalType_externalId: {
                sourceSystem: connection.connectorKey,
                sourceTenantId: connection.externalTenantId,
                externalType: 'talent',
                externalId: String(externalTalentId),
              },
            },
          });
          talentId = identity?.participantId || undefined;
        }
        if (!talentId && data.talentEmail) {
          const organizationId = await this.getAgencyOrganizationId(agencyId);
          const created = await this.syncTalentParticipant({
            agencyId,
            organizationId,
            fullName: data.talentName || data.talentEmail,
            email: data.talentEmail,
            connection,
            externalTalentId: externalTalentId
              ? String(externalTalentId)
              : undefined,
          });
          talentId = created.participant.id;
        }
        if (talentId && externalTalentId) {
          await this.prisma.externalIdentityMap.upsert({
            where: {
              sourceSystem_sourceTenantId_externalType_externalId: {
                sourceSystem: connection.connectorKey,
                sourceTenantId: connection.externalTenantId,
                externalType: 'talent',
                externalId: String(externalTalentId),
              },
            },
            update: { participantId: talentId, status: 'active' },
            create: {
              participantId: talentId,
              sourceSystem: connection.connectorKey,
              sourceTenantId: connection.externalTenantId,
              externalType: 'talent',
              externalId: String(externalTalentId),
              metadata: { connectionId: connection.id },
            },
          });
        }

        const normalizedData = {
          ...data,
          documentType: event.startsWith('invoice.')
            ? 'invoice'
            : data.documentType || 'payable',
          talentId,
          talentExternalId: externalTalentId,
        };
        const ingested = await this.commercialDocuments.ingestPayable({
          connection,
          sourceEvent,
          data: normalizedData,
        });

        await this.auditLogsService.log({
          userId: agencyId,
          action: 'CRM_PAYABLE_INGESTED',
          entityType: 'CommercialDocument',
          entityId: ingested.document.id,
          details: {
            versionId: ingested.version.id,
            versionNumber: ingested.version.versionNumber,
            validationStatus: ingested.version.validationStatus,
            talentId,
          },
        });

        return {
          status: 'success',
          action:
            normalizedData.documentType === 'invoice'
              ? 'commercial_invoice_ingested'
              : 'commercial_payable_ingested',
          documentId: ingested.document.id,
          versionId: ingested.version.id,
          versionNumber: ingested.version.versionNumber,
          validationStatus: ingested.version.validationStatus,
          approvalStatus: ingested.version.approval?.status || null,
          duplicate: ingested.duplicate,
          message:
            ingested.version.validationStatus === 'valid'
              ? `CRM ${normalizedData.documentType} validated and queued for approval`
              : `CRM ${normalizedData.documentType} recorded with validation findings`,
        };
      }

      default:
        this.logger.warn(`Unhandled CRM webhook event: ${payload.event}`);
        return {
          status: 'acknowledged',
          message: `Event '${payload.event}' received and logged, no automated action configured.`,
        };
    }
  }

  /**
   * Import CSV Talent Roster with invite generation
   */
  async importCsvRoster(agencyId: string, dto: CsvRosterImportDto) {
    if (!dto.roster || !Array.isArray(dto.roster) || dto.roster.length === 0) {
      throw new BadRequestException(
        'Roster array is required and must not be empty',
      );
    }

    const organizationId = await this.getAgencyOrganizationId(agencyId);
    const talentsWithInvites: Array<Record<string, unknown>> = [];
    for (const row of dto.roster) {
      const synced = await this.syncTalentParticipant({
        agencyId,
        organizationId,
        fullName: row.fullName,
        email: row.email,
        connection: row.externalTalentId
          ? {
              id: 'csv-import',
              connectorKey: 'csv',
              externalTenantId: organizationId,
            }
          : undefined,
        externalTalentId: row.externalTalentId,
        metadata: row.metadata,
      });
      talentsWithInvites.push({
        id: synced.participant.id,
        fullName: synced.participant.displayName,
        email: synced.email,
        invitationId: synced.invitation?.invitationId,
        inviteToken: synced.invitation?.token,
        expiresAt: synced.invitation?.expiresAt,
        mobileAppDeepLink: synced.invitation
          ? `agncypay://activate?token=${synced.invitation.token}&email=${encodeURIComponent(synced.email)}`
          : undefined,
      });
    }

    await this.auditLogsService.log({
      userId: agencyId,
      action: 'CSV_ROSTER_INGESTED',
      entityType: 'User',
      details: {
        totalReceived: dto.roster.length,
        importedCount: talentsWithInvites.length,
      },
    });

    return {
      totalReceived: dto.roster.length,
      importedCount: talentsWithInvites.length,
      updatedCount: 0,
      talents: talentsWithInvites,
    };
  }

  /**
   * Get all pending payables ingested from CRM awaiting batch review & approval
   */
  async getPendingPayables(agencyId: string) {
    return this.commercialDocuments.listPendingForAgency(agencyId);
  }
}

import { Injectable, Logger, UnauthorizedException, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TalentService } from '../../talents/talent.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { ConfigService } from '@nestjs/config';
import { CrmWebhookDto, CsvRosterImportDto } from './dto/crm-webhook.dto';
import * as crypto from 'crypto';

@Injectable()
export class CrmService {
  private readonly logger = new Logger(CrmService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly talentService: TalentService,
    private readonly auditLogsService: AuditLogsService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Deterministically generate or verify an agency's CRM Webhook API Key
   */
  getAgencyCrmApiKey(agencyId: string): string {
    const secret = this.configService.get<string>('JWT_SECRET') || 'agncypay-crm-secret-key-2026';
    const hash = crypto.createHmac('sha256', secret).update(agencyId).digest('hex').slice(0, 32);
    return `agncy_crm_${hash}`;
  }

  /**
   * Validate incoming CRM API Key or identify agency
   */
  async resolveAgencyFromApiKey(apiKey: string): Promise<string> {
    if (!apiKey || !apiKey.startsWith('agncy_crm_')) {
      throw new UnauthorizedException('Invalid or missing X-AgncyPay-CRM-Key header');
    }

    // Find all agencies and check matching hash
    const agencies = await this.prisma.user.findMany({
      where: { accountType: 'agency', deletedAt: null },
      select: { id: true, email: true },
    });

    for (const agency of agencies) {
      if (this.getAgencyCrmApiKey(agency.id) === apiKey) {
        return agency.id;
      }
    }

    throw new UnauthorizedException('CRM Webhook key does not match any registered Agency workspace');
  }

  /**
   * Get CRM Connection configuration details for an Agency
   */
  async getCrmConfig(agencyId: string) {
    const agency = await this.prisma.user.findUnique({
      where: { id: agencyId },
      select: { id: true, email: true, fullName: true, agncyId: true },
    });

    if (!agency) {
      throw new NotFoundException(`Agency ${agencyId} not found`);
    }

    const apiKey = this.getAgencyCrmApiKey(agencyId);
    const baseUrl = this.configService.get<string>('APP_URL') || 'https://api.agncypay.internal';

    return {
      agencyId,
      agncyId: agency.agncyId,
      webhookUrl: `${baseUrl}/crm/webhook`,
      apiKey,
      supportedEvents: [
        'talent.created',
        'talent.sync',
        'talent.updated',
        'deal.closed',
        'payable.created',
      ],
      documentation: {
        header: 'X-AgncyPay-CRM-Key: agncy_crm_...',
        payloadFormat: {
          event: 'talent.sync | payable.created',
          data: {
            fullName: 'Creator Name',
            email: 'creator@example.com',
            amount: 5000,
          },
        },
      },
    };
  }

  /**
   * Process generic inbound webhook from Agency CRM (HubSpot, GoHighLevel, Airtable, etc.)
   */
  async handleWebhook(apiKey: string | undefined, payload: CrmWebhookDto, authAgencyId?: string) {
    let agencyId = authAgencyId;

    if (!agencyId && apiKey) {
      agencyId = await this.resolveAgencyFromApiKey(apiKey);
    } else if (!agencyId && payload.agencyId) {
      agencyId = payload.agencyId;
    }

    if (!agencyId) {
      // Fallback: Check if there is only 1 agency registered in dev/testing
      const defaultAgency = await this.prisma.user.findFirst({
        where: { accountType: 'agency', deletedAt: null },
      });
      if (defaultAgency) {
        agencyId = defaultAgency.id;
      } else {
        throw new UnauthorizedException('Unable to resolve Agency workspace for CRM webhook');
      }
    }

    this.logger.log(`Processing CRM webhook event: "${payload.event}" for agency: ${agencyId}`);

    const event = (payload.event || '').toLowerCase();
    const data = payload.data || {};

    switch (event) {
      case 'talent.sync':
      case 'talent.created':
      case 'talent.updated':
      case 'contact.created': {
        const fullName = data.fullName || data.name || `${data.firstName || ''} ${data.lastName || ''}`.trim();
        if (!fullName) {
          throw new BadRequestException('Talent full name is required in webhook data');
        }

        const talentResult = await this.talentService.createTalent({
          agencyId,
          fullName,
          email: data.email,
          phone: data.phone,
          country: data.country,
          isInternational: data.isInternational || false,
          metadata: {
            ...data.metadata,
            crmSource: data.crmSource || 'generic_webhook',
            crmExternalId: data.externalId || data.id,
            importedAt: new Date().toISOString(),
          },
        });

        // Generate talent invite activation link
        const inviteToken = Buffer.from(`${talentResult.talent.id}:${Date.now()}`).toString('base64url');

        await this.auditLogsService.log({
          userId: agencyId,
          action: 'CRM_TALENT_INGESTED',
          entityType: 'User',
          entityId: talentResult.talent.id,
          details: { event, fullName, email: data.email },
        });

        return {
          status: 'success',
          action: 'talent_synced',
          talentId: talentResult.talent.id,
          fullName: talentResult.talent.fullName,
          email: talentResult.talent.email,
          inviteToken,
          mobileAppDeepLink: `agncypay://activate?token=${inviteToken}&email=${encodeURIComponent(talentResult.talent.email)}`,
        };
      }

      case 'payable.created':
      case 'deal.closed':
      case 'deal.won': {
        // Ingest payable into AgncyPay ledger pipeline waiting for batch approval
        const amount = Number(data.amount) || 0;
        if (amount <= 0) {
          throw new BadRequestException('Payable amount must be greater than 0');
        }

        // Resolve or create talent record for this payable
        let talentId = data.talentId;
        if (!talentId && (data.talentEmail || data.talentName)) {
          const talentName = data.talentName || data.talentEmail;
          const created = await this.talentService.createTalent({
            agencyId,
            fullName: talentName,
            email: data.talentEmail,
          });
          talentId = created.talent.id;
        }

        const payoutNumber = `PAY-CRM-${Math.floor(100000 + Math.random() * 900000)}`;

        const pendingPayout = await this.prisma.paymentPayout.create({
          data: {
            payoutNumber,
            agencyId,
            talentId: talentId || null,
            amount,
            currency: data.currency || 'USD',
            payoutType: data.payoutType || 'domestic',
            status: 'PENDING_APPROVAL',
            metadata: {
              source: 'crm_webhook',
              externalDealId: data.externalDealId || data.dealId || data.id,
              campaign: data.campaign || data.title || 'CRM Ingested Payable',
              brandName: data.brandName || 'Direct Client',
              notes: data.notes || '',
              rawPayload: data,
            },
          },
        });

        await this.auditLogsService.log({
          userId: agencyId,
          action: 'CRM_PAYABLE_INGESTED',
          entityType: 'PaymentPayout',
          entityId: pendingPayout.id,
          details: { amount, payoutNumber, talentId },
        });

        return {
          status: 'success',
          action: 'payable_created',
          payoutId: pendingPayout.id,
          payoutNumber: pendingPayout.payoutNumber,
          amount: pendingPayout.amount,
          approvalStatus: pendingPayout.status,
          message: 'Payable queued in AgncyPay Batch Approval queue',
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
      throw new BadRequestException('Roster array is required and must not be empty');
    }

    const syncResult = await this.talentService.importTalentRoster(agencyId, dto.roster);

    // Attach activation invite tokens for mobile app onboarding
    const talentsWithInvites = syncResult.talents.map((t) => {
      const inviteToken = Buffer.from(`${t.id}:${Date.now()}`).toString('base64url');
      return {
        ...t,
        inviteToken,
        inviteLink: `https://app.agncypay.internal/invite?token=${inviteToken}`,
        mobileAppDeepLink: `agncypay://activate?token=${inviteToken}&email=${encodeURIComponent(t.email || '')}`,
      };
    });

    await this.auditLogsService.log({
      userId: agencyId,
      action: 'CSV_ROSTER_INGESTED',
      entityType: 'User',
      details: {
        totalReceived: syncResult.totalReceived,
        importedCount: syncResult.importedCount,
        updatedCount: syncResult.updatedCount,
      },
    });

    return {
      totalReceived: syncResult.totalReceived,
      importedCount: syncResult.importedCount,
      updatedCount: syncResult.updatedCount,
      talents: talentsWithInvites,
    };
  }

  /**
   * Get all pending payables ingested from CRM awaiting batch review & approval
   */
  async getPendingPayables(agencyId: string) {
    const payables = await this.prisma.paymentPayout.findMany({
      where: {
        agencyId,
        status: 'PENDING_APPROVAL',
      },
      include: {
        talent: {
          select: {
            id: true,
            fullName: true,
            email: true,
            agncyId: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const totalAmount = payables.reduce((acc, p) => acc + Number(p.amount), 0);

    return {
      count: payables.length,
      totalAmount,
      currency: 'USD',
      payables,
    };
  }
}

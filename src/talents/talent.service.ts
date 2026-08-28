import { Injectable, NotFoundException, BadRequestException, Logger, Inject } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../modules/audit-logs/audit-logs.service';
import { CybridCustomerService } from '../modules/cybrid/cybrid-customer.service';
import { ExternalBankAccountService } from '../modules/cybrid/external-bank-account.service';
import { CybridConfigService } from '../infrastructure/providers/cybrid/cybrid-config.service';
import type { IFinancialProvider } from '../core/interfaces/financial-provider.interface';

@Injectable()
export class TalentService {
  private readonly logger = new Logger(TalentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
    private readonly customerService: CybridCustomerService,
    private readonly externalBankAccountService: ExternalBankAccountService,
    private readonly config: CybridConfigService,
    @Inject('IFinancialProvider') private readonly cybridProvider: IFinancialProvider,
  ) {}

  async createTalent(data: {
    agencyId: string;
    fullName: string;
    email?: string;
    phone?: string;
    country?: string;
    isInternational?: boolean;
    metadata?: Record<string, any>;
  }) {
    if (!data.fullName) {
      throw new BadRequestException('Talent full name is required');
    }

    const agency = await this.prisma.user.findUnique({ where: { id: data.agencyId } });
    if (!agency) {
      throw new NotFoundException(`Agency ${data.agencyId} not found`);
    }

    // 1. Create Talent in DB
    const talent = await this.prisma.talent.create({
      data: {
        agencyId: data.agencyId,
        fullName: data.fullName,
        email: data.email,
        phone: data.phone,
        country: data.country || 'US',
        isInternational: data.isInternational ?? (data.country ? data.country !== 'US' : false),
        metadata: data.metadata || {},
      },
    });

    // 2. Ensure Agency has a Cybrid Customer so counterparty is customer-owned
    const customer = await this.customerService.createOrGetCustomer(data.agencyId);

    // 3. Create Cybrid Counterparty (Customer-Owned!)
    let counterpartyGuid: string;
    try {
      if (this.config.isConfigured) {
        const nameParts = data.fullName.trim().split(' ');
        const firstName = nameParts[0];
        const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : 'Talent';

        const country = data.country || 'US';
        const postalCode = country === 'BR' ? '01310-100' : (country === 'CA' ? 'M5V 2T6' : '94105');
        const city = country === 'BR' ? 'Sao Paulo' : (country === 'CA' ? 'Toronto' : 'San Francisco');
        const subdivision = country === 'BR' ? 'SP' : (country === 'CA' ? 'ON' : 'CA');

        const cpResp = await this.cybridProvider.createCounterparty({
          customerGuid: customer.cybridCustomerGuid,
          type: 'individual',
          name: {
            first: firstName,
            last: lastName,
            full: data.fullName,
          },
          address: {
            street: '123 Talent Way',
            city,
            subdivision,
            postalCode,
            countryCode: country,
          },
          email: data.email,
          phone: data.phone,
        });
        counterpartyGuid = cpResp.guid;
      } else {
        counterpartyGuid = `cp_cyb_${Date.now()}`;
      }
    } catch (err) {
      this.logger.warn(`Cybrid counterparty creation failed, using sandbox fallback: ${err.message}`);
      counterpartyGuid = `cp_cyb_${Date.now()}`;
    }

    // 4. Save CybridCounterparty in database linked to Talent and Agency's Cybrid Customer
    const counterparty = await this.prisma.cybridCounterparty.create({
      data: {
        cybridCustomerId: customer.id,
        cybridCounterpartyGuid: counterpartyGuid,
        name: data.fullName,
        counterpartyType: 'individual',
        talentId: talent.id,
        status: 'verified',
      },
    });

    await this.auditLogsService.log({
      userId: data.agencyId,
      action: 'TALENT_CREATED_WITH_COUNTERPARTY',
      entityType: 'Talent',
      entityId: talent.id,
      details: {
        talentName: talent.fullName,
        counterpartyGuid,
        isInternational: talent.isInternational,
      },
    });

    return {
      talent,
      counterparty,
    };
  }

  async linkBankAccount(
    talentId: string,
    agencyId: string,
    bankData: {
      bankName: string;
      accountNumber: string;
      routingNumber: string;
      accountHolderName?: string;
    },
  ) {
    const talent = await this.getTalentById(talentId, agencyId);

    return this.externalBankAccountService.linkTalentBankAccount({
      agencyId,
      talentId: talent.id,
      bankName: bankData.bankName,
      accountNumber: bankData.accountNumber,
      routingNumber: bankData.routingNumber,
      accountHolderName: bankData.accountHolderName,
    });
  }

  async getTalents(agencyId: string) {
    return this.prisma.talent.findMany({
      where: { agencyId, deletedAt: null },
      include: {
        counterparties: {
          include: { externalBankAccounts: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getTalentById(talentId: string, agencyId: string) {
    const talent = await this.prisma.talent.findFirst({
      where: { id: talentId, agencyId, deletedAt: null },
      include: {
        counterparties: {
          include: { externalBankAccounts: true },
        },
        paymentPayouts: {
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
      },
    });

    if (!talent) {
      throw new NotFoundException(`Talent ${talentId} not found`);
    }

    return talent;
  }

  async updateTalent(talentId: string, agencyId: string, data: any) {
    await this.getTalentById(talentId, agencyId);

    const updated = await this.prisma.talent.update({
      where: { id: talentId },
      data: {
        fullName: data.fullName,
        email: data.email,
        phone: data.phone,
        country: data.country,
        isInternational: data.isInternational,
        status: data.status,
      },
    });

    await this.auditLogsService.log({
      userId: agencyId,
      action: 'TALENT_UPDATED',
      entityType: 'Talent',
      entityId: talentId,
      details: data,
    });

    return updated;
  }

  async deleteTalent(talentId: string, agencyId: string) {
    await this.getTalentById(talentId, agencyId);

    const deleted = await this.prisma.talent.update({
      where: { id: talentId },
      data: { deletedAt: new Date() },
    });

    await this.auditLogsService.log({
      userId: agencyId,
      action: 'TALENT_DELETED',
      entityType: 'Talent',
      entityId: talentId,
    });

    return { success: true };
  }
}


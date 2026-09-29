import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../modules/audit-logs/audit-logs.service';
import * as bcrypt from 'bcrypt';

@Injectable()
export class TalentService {
  private readonly logger = new Logger(TalentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
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

    const email = data.email
      ? data.email.trim().toLowerCase()
      : `talent_${Date.now()}_${Math.random().toString(36).substring(2, 7)}@agncypay.internal`;

    // 1. Create or Find Talent User
    let talent = await this.prisma.user.findFirst({
      where: { email, deletedAt: null },
    });

    if (!talent) {
      const tempPassword = Math.random().toString(36).slice(-10) + 'A1!';
      const hashedPassword = await bcrypt.hash(tempPassword, 10);

      talent = await this.prisma.user.create({
        data: {
          agencyId: data.agencyId,
          email,
          password: hashedPassword,
          fullName: data.fullName,
          accountType: 'talent',
          agncyId: `TAL-${Math.floor(100000 + Math.random() * 900000)}`,
          emailVerified: true,
        },
      });
    }

    // 2. Provision Conduit Recipient / Beneficiary Record
    const recipientId = `rec_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    let customer = await this.prisma.conduitCustomer.findFirst({
      where: { userId: data.agencyId },
    });
    if (!customer) {
      customer = await this.prisma.conduitCustomer.create({
        data: {
          userId: data.agencyId,
          conduitCustomerId: `cust_${data.agencyId}`,
          kybStatus: 'approved',
          status: 'active',
        },
      });
    }

    const recipient = await this.prisma.conduitRecipient.create({
      data: {
        conduitCustomerId: customer.id,
        recipientId,
        name: data.fullName,
        recipientType: 'individual',
        talentId: talent.id,
        status: 'active',
        payoutRail: 'ach',
      },
    });

    await this.auditLogsService.log({
      userId: data.agencyId,
      action: 'TALENT_CREATED',
      entityType: 'User',
      entityId: talent.id,
      details: {
        talentName: talent.fullName,
        recipientId: recipient.recipientId,
        isInternational: data.isInternational || false,
      },
    });

    return {
      talent,
      recipient,
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

    // Save BankDetails for the talent
    const accountMask = bankData.accountNumber.slice(-4);
    const bankDetails = await this.prisma.bankDetails.upsert({
      where: { userId: talent.id },
      update: {
        bankName: bankData.bankName,
        accountNumber: `****${accountMask}`,
        routingNumber: bankData.routingNumber,
        accountHolderName: bankData.accountHolderName || talent.fullName,
        status: 'approved',
      },
      create: {
        userId: talent.id,
        bankName: bankData.bankName,
        accountNumber: `****${accountMask}`,
        routingNumber: bankData.routingNumber,
        accountHolderName: bankData.accountHolderName || talent.fullName,
        status: 'approved',
      },
    });

    await this.auditLogsService.log({
      userId: agencyId,
      action: 'TALENT_BANK_LINKED',
      entityType: 'BankDetails',
      entityId: bankDetails.id,
      details: {
        talentId: talent.id,
        bankName: bankData.bankName,
        accountMask,
      },
    });

    return bankDetails;
  }

  async getTalents(agencyId: string) {
    return this.prisma.user.findMany({
      where: { agencyId, accountType: 'talent', deletedAt: null },
      include: {
        talentRecipients: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getTalentById(talentId: string, agencyId: string) {
    const talent = await this.prisma.user.findFirst({
      where: { id: talentId, agencyId, accountType: 'talent', deletedAt: null },
      include: {
        talentRecipients: true,
        talentPayouts: {
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

    const updated = await this.prisma.user.update({
      where: { id: talentId },
      data: {
        fullName: data.fullName,
        email: data.email,
      },
    });

    await this.auditLogsService.log({
      userId: agencyId,
      action: 'TALENT_UPDATED',
      entityType: 'User',
      entityId: talentId,
      details: data,
    });

    return updated;
  }

  async deleteTalent(talentId: string, agencyId: string) {
    await this.getTalentById(talentId, agencyId);

    await this.prisma.user.update({
      where: { id: talentId },
      data: { deletedAt: new Date() },
    });

    await this.auditLogsService.log({
      userId: agencyId,
      action: 'TALENT_DELETED',
      entityType: 'User',
      entityId: talentId,
    });

    return { success: true };
  }

  async getTalentPayouts(talentId: string, agencyId: string) {
    await this.getTalentById(talentId, agencyId);

    return this.prisma.paymentPayout.findMany({
      where: { talentId, agencyId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getTalentEarnings(talentId: string, agencyId: string) {
    await this.getTalentById(talentId, agencyId);

    const payouts = await this.prisma.paymentPayout.findMany({
      where: { talentId, agencyId },
    });

    let totalEarned = 0;
    let pendingPayouts = 0;
    let completedCount = 0;
    let pendingCount = 0;

    for (const p of payouts) {
      const amt = Number(p.amount) || 0;
      if (p.status === 'COMPLETED') {
        totalEarned += amt;
        completedCount++;
      } else if (!['FAILED', 'RETURNED', 'CANCELLED'].includes(p.status)) {
        pendingPayouts += amt;
        pendingCount++;
      }
    }

    return {
      talentId,
      totalEarned,
      pendingPayouts,
      completedCount,
      pendingCount,
      totalPayoutsCount: payouts.length,
      currency: 'USD',
    };
  }

  async getTalentBanking(talentId: string, agencyId: string) {
    const talent = await this.getTalentById(talentId, agencyId);

    const recipients = (talent.talentRecipients || []).map((rec) => ({
      guid: rec.recipientId,
      name: rec.name,
      type: rec.recipientType,
      status: rec.status,
      rail: rec.payoutRail,
      accountMask: rec.accountNumberMask,
      walletAddress: rec.walletAddress,
    }));

    return {
      talentId: talent.id,
      fullName: talent.fullName,
      recipients,
    };
  }

  /**
   * Import or bulk-sync talent roster exported from Agency CRM / CSV
   */
  async importTalentRoster(
    agencyId: string,
    roster: Array<{
      externalTalentId?: string;
      fullName: string;
      email?: string;
      phone?: string;
      country?: string;
      isInternational?: boolean;
      metadata?: Record<string, any>;
    }>,
  ) {
    const results = {
      totalReceived: roster.length,
      importedCount: 0,
      updatedCount: 0,
      talents: [] as any[],
    };

    for (const item of roster) {
      if (!item.fullName) continue;

      const email = item.email ? item.email.trim().toLowerCase() : undefined;
      const existing = email
        ? await this.prisma.user.findFirst({
            where: { agencyId, email, accountType: 'talent', deletedAt: null },
          })
        : await this.prisma.user.findFirst({
            where: { agencyId, fullName: item.fullName, accountType: 'talent', deletedAt: null },
          });

      if (existing) {
        const updated = await this.prisma.user.update({
          where: { id: existing.id },
          data: {
            fullName: item.fullName || existing.fullName,
            email: email || existing.email,
          },
        });
        results.updatedCount++;
        results.talents.push(updated);
      } else {
        const created = await this.createTalent({
          agencyId,
          fullName: item.fullName,
          email: item.email,
          phone: item.phone,
          country: item.country,
          isInternational: item.isInternational,
          metadata: item.metadata,
        });
        results.importedCount++;
        results.talents.push(created.talent);
      }
    }

    await this.auditLogsService.log({
      userId: agencyId,
      action: 'TALENT_ROSTER_IMPORTED',
      entityType: 'User',
      details: {
        totalReceived: results.totalReceived,
        importedCount: results.importedCount,
        updatedCount: results.updatedCount,
      },
    });

    return results;
  }
}

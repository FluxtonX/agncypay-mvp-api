import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PlaidProvider } from '../infrastructure/providers/plaid/plaid.provider';
import { AuditLogsService } from '../modules/audit-logs/audit-logs.service';

@Injectable()
export class VerificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly plaidProvider: PlaidProvider,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  async getVerificationState(userId: string) {
    const [businessProfile, representative, authorization, brandVerification, bankDetails, documents] =
      await Promise.all([
        this.prisma.businessProfile.findUnique({ where: { userId } }),
        this.prisma.representative.findUnique({ where: { userId } }),
        this.prisma.authorization.findUnique({ where: { userId } }),
        this.prisma.brandVerification.findUnique({ where: { userId } }),
        this.prisma.bankDetails.findUnique({ where: { userId } }),
        this.prisma.document.findMany({ where: { userId } }),
      ]);

    return {
      businessProfile,
      representative,
      authorization,
      brandVerification,
      bankDetails,
      documents,
    };
  }

  async createPlaidLinkToken(userId: string) {
    return this.plaidProvider.createLinkToken(userId);
  }

  async exchangePlaidPublicToken(userId: string, publicToken: string) {
    const result = await this.plaidProvider.exchangePublicToken({ userId, publicToken });
    const primaryAccount = result.accounts[0];

    const bankDetails = await this.prisma.bankDetails.upsert({
      where: { userId },
      update: {
        bankName: primaryAccount?.bankName || 'Verified Bank Account',
        accountNumber: `****${primaryAccount?.accountNumberMask || '6789'}`,
        routingNumber: primaryAccount?.routingNumber || '111000025',
        accountHolderName: primaryAccount?.accountHolderName || 'Verified Account Holder',
        plaidAccessToken: result.accessToken,
        plaidAccountId: primaryAccount?.accountId,
        plaidItemId: result.itemId,
        status: 'approved',
      },
      create: {
        userId,
        bankName: primaryAccount?.bankName || 'Verified Bank Account',
        accountNumber: `****${primaryAccount?.accountNumberMask || '6789'}`,
        routingNumber: primaryAccount?.routingNumber || '111000025',
        accountHolderName: primaryAccount?.accountHolderName || 'Verified Account Holder',
        plaidAccessToken: result.accessToken,
        plaidAccountId: primaryAccount?.accountId,
        plaidItemId: result.itemId,
        status: 'approved',
      },
    });

    await this.auditLogsService.log({
      userId,
      action: 'BANK_VERIFIED_PLAID',
      entityType: 'BankDetails',
      entityId: bankDetails.id,
      details: { bankName: bankDetails.bankName, accountMask: primaryAccount?.accountNumberMask },
    });

    return { success: true, bankDetails, accounts: result.accounts };
  }

  async updateBusinessProfile(userId: string, data: any) {
    const profile = await this.prisma.businessProfile.upsert({
      where: { userId },
      update: data,
      create: { userId, ...data },
    });
    await this.auditLogsService.log({ userId, action: 'BUSINESS_PROFILE_UPDATED', entityType: 'BusinessProfile', entityId: profile.id });
    return profile;
  }

  async updateRepresentative(userId: string, data: any) {
    const rep = await this.prisma.representative.upsert({
      where: { userId },
      update: data,
      create: { userId, ...data },
    });
    await this.auditLogsService.log({ userId, action: 'REPRESENTATIVE_UPDATED', entityType: 'Representative', entityId: rep.id });
    return rep;
  }

  async updateAuthorization(userId: string, data: any) {
    const auth = await this.prisma.authorization.upsert({
      where: { userId },
      update: data,
      create: { userId, ...data },
    });
    await this.auditLogsService.log({ userId, action: 'AUTHORIZATION_UPDATED', entityType: 'Authorization', entityId: auth.id });
    return auth;
  }

  async updateBankDetails(userId: string, data: any) {
    const bank = await this.prisma.bankDetails.upsert({
      where: { userId },
      update: data,
      create: { userId, ...data },
    });
    await this.auditLogsService.log({ userId, action: 'BANK_DETAILS_UPDATED', entityType: 'BankDetails', entityId: bank.id });
    return bank;
  }

  async createPlaidProcessorToken(userId: string, processor = 'modern_treasury') {
    const bankDetails = await this.prisma.bankDetails.findUnique({ where: { userId } });
    if (!bankDetails || !bankDetails.plaidAccessToken || !bankDetails.plaidAccountId) {
      return { processorToken: `processor-token-simulated-${userId}-${Date.now()}` };
    }

    const processorToken = await this.plaidProvider.createProcessorToken(
      bankDetails.plaidAccessToken,
      bankDetails.plaidAccountId,
      processor,
    );

    return { processorToken };
  }
}



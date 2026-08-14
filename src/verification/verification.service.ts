import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PlaidProvider } from '../infrastructure/providers/plaid/plaid.provider';
import { ModernTreasuryProvider } from '../infrastructure/providers/modern-treasury/modern-treasury.provider';
import { AuditLogsService } from '../modules/audit-logs/audit-logs.service';

@Injectable()
export class VerificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly plaidProvider: PlaidProvider,
    private readonly modernTreasuryProvider: ModernTreasuryProvider,
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

  async submitLegalEntityToModernTreasury(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new Error(`User ${userId} not found`);
    }

    const businessProfile = await this.prisma.businessProfile.findUnique({ where: { userId } });

    const legalName = businessProfile?.legalName || user.fullName || 'Agency Legal Entity';

    const leResult = await this.modernTreasuryProvider.createLegalEntity({
      agencyId: userId,
      legalName,
      businessType: businessProfile?.businessType,
      registrationNumber: businessProfile?.registrationNumber,
      taxId: businessProfile?.taxId || undefined,
      address: {
        line1: businessProfile?.addressLine1,
        line2: businessProfile?.addressLine2,
        city: businessProfile?.city,
        state: businessProfile?.businessState,
        postalCode: businessProfile?.postalCode,
        country: businessProfile?.country || 'USA',
      },
    });

    const isApproved = leResult.status === 'approved';
    let internalAccountId: string | undefined = user.modernTreasuryInternalAccountId || undefined;
    let ledgerAccountId: string | undefined = user.modernTreasuryLedgerAccountId || undefined;
    let counterpartyId: string | undefined = user.modernTreasuryCounterpartyId || undefined;

    if (isApproved) {
      if (!internalAccountId) {
        const iaResult = await this.modernTreasuryProvider.createInternalAccount({
          name: legalName,
          legalEntityId: leResult.legalEntityId,
        });
        internalAccountId = iaResult.internalAccountId;
        ledgerAccountId = iaResult.ledgerAccountId;
      }

      if (!counterpartyId) {
        const cpResult = await this.modernTreasuryProvider.createCounterparty({
          name: legalName,
          metadata: { userId, accountType: user.accountType },
        });
        counterpartyId = cpResult.counterpartyId;
      }
    }

    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: {
        modernTreasuryLegalEntityId: leResult.legalEntityId,
        modernTreasuryInternalAccountId: internalAccountId,
        modernTreasuryLedgerAccountId: ledgerAccountId,
        modernTreasuryCounterpartyId: counterpartyId,
        kybStatus: isApproved ? 'approved' : 'pending',
      },
    });

    await this.auditLogsService.log({
      userId,
      action: 'LEGAL_ENTITY_SUBMITTED_MT',
      entityType: 'User',
      entityId: userId,
      details: {
        legalEntityId: leResult.legalEntityId,
        kybStatus: updatedUser.kybStatus,
        internalAccountId,
        counterpartyId,
      },
    });

    return {
      success: true,
      legalEntityId: leResult.legalEntityId,
      kybStatus: updatedUser.kybStatus,
      internalAccountId: updatedUser.modernTreasuryInternalAccountId,
      counterpartyId: updatedUser.modernTreasuryCounterpartyId,
    };
  }

  async setupBrandFundingAccount(userId: string, accountNumber: string, routingNumber: string, bankName?: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new Error(`User ${userId} not found`);
    }

    let counterpartyId = user.modernTreasuryCounterpartyId;
    if (!counterpartyId) {
      const cpResult = await this.modernTreasuryProvider.createCounterparty({
        name: user.fullName || 'Brand Partner',
        metadata: { userId, accountType: 'brand' },
      });
      counterpartyId = cpResult.counterpartyId;
    }

    const eaResult = await this.modernTreasuryProvider.createExternalAccount({
      counterpartyId,
      name: `${bankName || 'Brand'} Funding Account`,
      accountNumber,
      routingNumber,
    });

    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: {
        modernTreasuryCounterpartyId: counterpartyId,
      },
    });

    await this.auditLogsService.log({
      userId,
      action: 'BRAND_EXTERNAL_ACCOUNT_CREATED',
      entityType: 'User',
      entityId: userId,
      details: { counterpartyId, externalAccountId: eaResult.externalAccountId },
    });

    return {
      success: true,
      counterpartyId,
      externalAccountId: eaResult.externalAccountId,
    };
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



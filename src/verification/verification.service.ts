import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PlaidProvider } from '../infrastructure/providers/plaid/plaid.provider';
import { AuditLogsService } from '../modules/audit-logs/audit-logs.service';
import { CybridCustomerService } from '../modules/cybrid/cybrid-customer.service';
import { CybridAccountService } from '../modules/cybrid/cybrid-account.service';
import { encryptText, decryptText } from '../common/utils/crypto.util';

@Injectable()
export class VerificationService {
  private readonly logger = new Logger(VerificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly plaidProvider: PlaidProvider,
    private readonly auditLogsService: AuditLogsService,
    private readonly cybridCustomerService: CybridCustomerService,
    private readonly cybridAccountService: CybridAccountService,
  ) {}

  async getVerificationState(userId: string) {
    const [
      user,
      businessProfile,
      representative,
      authorization,
      brandVerification,
      bankDetails,
      documents,
      cybridCustomer,
    ] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, kybStatus: true } }),
      this.prisma.businessProfile.findUnique({ where: { userId } }),
      this.prisma.representative.findUnique({ where: { userId } }),
      this.prisma.authorization.findUnique({ where: { userId } }),
      this.prisma.brandVerification.findUnique({ where: { userId } }),
      this.prisma.bankDetails.findUnique({ where: { userId } }),
      this.prisma.document.findMany({ where: { userId } }),
      this.prisma.cybridCustomer.findUnique({
        where: { userId },
        include: { accounts: { include: { depositBankAccounts: true } } },
      }),
    ]);

    const effectiveKybStatus = user?.kybStatus || cybridCustomer?.kybStatus || (businessProfile?.legalName ? 'pending' : 'not_started');

    return {
      businessProfile,
      representative,
      authorization,
      brandVerification,
      bankDetails,
      documents,
      cybridCustomer,
      kybStatus: effectiveKybStatus,
      legalEntityId: cybridCustomer?.cybridCustomerGuid || null,
      depositAccount: cybridCustomer?.accounts?.flatMap((a) => a.depositBankAccounts)?.[0] || null,
    };
  }

  private async resolveAgencyUserId(userId?: string): Promise<string> {
    if (userId) return userId;
    const defaultAgency = await this.prisma.user.findFirst({
      where: { accountType: 'agency', deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return defaultAgency?.id || 'b40cf746-543a-48ce-9c28-b6e97c427f22';
  }

  async createPlaidLinkToken(userId?: string) {
    const targetUserId = await this.resolveAgencyUserId(userId);
    return this.plaidProvider.createLinkToken(targetUserId);
  }

  async exchangePlaidPublicToken(userId: string | undefined, publicToken: string, institutionMetadata?: any) {
    const targetUserId = await this.resolveAgencyUserId(userId);
    const result = await this.plaidProvider.exchangePublicToken({ userId: targetUserId, publicToken });
    const primaryAccount = result.accounts[0];

    const encryptedAccessToken = encryptText(result.accessToken);
    const encryptedAccountId = primaryAccount?.accountId ? encryptText(primaryAccount.accountId) : null;
    const encryptedItemId = result.itemId ? encryptText(result.itemId) : null;

    const bankName = institutionMetadata?.name || primaryAccount?.bankName || 'Verified Bank Account';

    const bankDetails = await this.prisma.bankDetails.upsert({
      where: { userId: targetUserId },
      update: {
        bankName,
        accountNumber: `****${primaryAccount?.accountNumberMask || '6789'}`,
        routingNumber: primaryAccount?.routingNumber || '111000025',
        accountHolderName: primaryAccount?.accountHolderName || 'Verified Account Holder',
        plaidAccessToken: encryptedAccessToken,
        plaidAccountId: encryptedAccountId,
        plaidItemId: encryptedItemId,
        status: 'approved',
      },
      create: {
        userId: targetUserId,
        bankName,
        accountNumber: `****${primaryAccount?.accountNumberMask || '6789'}`,
        routingNumber: primaryAccount?.routingNumber || '111000025',
        accountHolderName: primaryAccount?.accountHolderName || 'Verified Account Holder',
        plaidAccessToken: encryptedAccessToken,
        plaidAccountId: encryptedAccountId,
        plaidItemId: encryptedItemId,
        status: 'approved',
      },
    });

    // Save all accounts returned by Plaid into agencyExternalAccount table
    for (const acc of result.accounts) {
      const extAccountId = acc.accountId || `plaid_${bankDetails.id}_${acc.accountNumberMask}`;
      await this.prisma.agencyExternalAccount.upsert({
        where: { providerExternalAccountId: extAccountId },
        update: {
          accountName: acc.accountName || acc.accountHolderName || `${bankName} Checking`,
          bankName,
          accountNumberMask: acc.accountNumberMask || '6789',
          routingNumber: acc.routingNumber || '111000025',
          isPrimary: acc.accountId === primaryAccount?.accountId,
        },
        create: {
          agencyId: targetUserId,
          accountName: acc.accountName || acc.accountHolderName || `${bankName} Checking`,
          bankName,
          accountNumberMask: acc.accountNumberMask || '6789',
          routingNumber: acc.routingNumber || '111000025',
          providerExternalAccountId: extAccountId,
          isPrimary: acc.accountId === primaryAccount?.accountId,
        },
      });
    }

    await this.auditLogsService.log({
      userId: targetUserId,
      action: 'BANK_VERIFIED_PLAID',
      entityType: 'BankDetails',
      entityId: bankDetails.id,
      details: { bankName, totalAccounts: result.accounts.length, accounts: result.accounts.map(a => a.accountNumberMask) },
    });

    return { success: true, bankDetails, accounts: result.accounts };
  }

  async linkPlaidSandboxAccount(userId?: string, institutionId = 'ins_3') {
    const targetUserId = await this.resolveAgencyUserId(userId);
    const publicToken = await this.plaidProvider.createSandboxPublicToken(institutionId);
    return this.exchangePlaidPublicToken(targetUserId, publicToken);
  }

  async getLinkedAccounts(userId?: string) {
    const targetUserId = await this.resolveAgencyUserId(userId);
    const externalAccounts = await this.prisma.agencyExternalAccount.findMany({
      where: { agencyId: targetUserId },
      orderBy: { createdAt: 'desc' },
    });

    const bankDetails = await this.prisma.bankDetails.findUnique({
      where: { userId: targetUserId },
    });

    return {
      success: true,
      bankDetails,
      accounts: externalAccounts,
    };
  }

  async disconnectAccount(userId: string | undefined, accountId: string) {
    const targetUserId = await this.resolveAgencyUserId(userId);
    // Delete matching agencyExternalAccount
    await this.prisma.agencyExternalAccount.deleteMany({
      where: {
        agencyId: targetUserId,
        OR: [
          { id: accountId },
          { providerExternalAccountId: accountId },
        ],
      },
    });

    // Check if any external accounts remain
    const remaining = await this.prisma.agencyExternalAccount.count({
      where: { agencyId: targetUserId },
    });

    if (remaining === 0) {
      await this.prisma.bankDetails.deleteMany({
        where: { userId: targetUserId },
      });
    }

    return { success: true, remaining };
  }

  async updateBusinessProfile(userId: string, data: any) {
    const allowedFields: Record<string, any> = {
      legalName: data.legalName,
      brandName: data.brandName || data.tradeName,
      businessType: data.businessType,
      country: data.country,
      registrationNumber: data.registrationNumber,
      taxId: data.taxId,
      website: data.website,
      email: data.email,
      phone: data.phone,
      industry: data.industry,
      address: data.address,
      addressLine1: data.addressLine1,
      addressLine2: data.addressLine2,
      city: data.city,
      businessState: data.businessState || data.stateOrProvince,
      stateOrProvince: data.stateOrProvince || data.businessState,
      zipCode: data.zipCode || data.postalCode,
      postalCode: data.postalCode || data.zipCode,
      companyDescription: data.companyDescription,
      firstName: data.firstName,
      lastName: data.lastName,
      dob: data.dob,
      ssnLast4: data.ssnLast4,
    };

    const cleanData = Object.fromEntries(
      Object.entries(allowedFields).filter(([_, v]) => v !== undefined && v !== null)
    );

    const profile = await this.prisma.businessProfile.upsert({
      where: { userId },
      update: cleanData,
      create: { userId, ...cleanData },
    });
    await this.auditLogsService.log({ userId, action: 'BUSINESS_PROFILE_UPDATED', entityType: 'BusinessProfile', entityId: profile.id });
    return profile;
  }

  async updateRepresentative(userId: string, data: any) {
    const allowedFields: Record<string, any> = {
      fullName: data.fullName,
      jobTitle: data.jobTitle,
      dob: data.dob,
      nationality: data.nationality,
      email: data.email,
      phone: data.phone,
      address: data.address,
      idType: data.idType,
      idFrontUploaded: data.idFrontUploaded,
      idBackUploaded: data.idBackUploaded,
      selfieUploaded: data.selfieUploaded,
    };

    const cleanData = Object.fromEntries(
      Object.entries(allowedFields).filter(([_, v]) => v !== undefined && v !== null)
    );

    const rep = await this.prisma.representative.upsert({
      where: { userId },
      update: cleanData,
      create: { userId, ...cleanData },
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

  async submitLegalEntity(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new Error(`User ${userId} not found`);
    }

    // 1. Create Cybrid Business Customer and trigger KYB
    const kybResult = await this.cybridCustomerService.initiateKYB(userId);

    // 2. Automatically provision USD Fiat Account & Deposit Bank Account
    const depositAccount = await this.cybridAccountService.ensureDepositBankAccount(userId);

    await this.auditLogsService.log({
      userId,
      action: 'CYBRID_ONBOARDING_COMPLETED',
      entityType: 'User',
      entityId: userId,
      details: {
        customerGuid: kybResult.customer.cybridCustomerGuid,
        kybStatus: kybResult.kybStatus,
        depositBankGuid: depositAccount.cybridDepositBankGuid,
      },
    });

    return {
      success: true,
      legalEntityId: kybResult.customer.cybridCustomerGuid,
      kybStatus: kybResult.kybStatus,
      internalAccountId: depositAccount.cybridAccountId,
      counterpartyId: kybResult.customer.cybridCustomerGuid,
      depositAccount,
    };
  }

  async setupBrandFundingAccount(userId: string, accountNumber: string, routingNumber: string, bankName?: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException(`User ${userId} not found`);
    }

    const mask = accountNumber.length >= 4 ? accountNumber.slice(-4) : 'XXXX';
    const bankDetails = await this.prisma.bankDetails.upsert({
      where: { userId },
      update: {
        bankName: bankName || 'Brand Linked Bank',
        accountNumber: `****${mask}`,
        routingNumber,
        accountHolderName: user.fullName || 'Brand Partner',
        status: 'approved',
      },
      create: {
        userId,
        bankName: bankName || 'Brand Linked Bank',
        accountNumber: `****${mask}`,
        routingNumber,
        accountHolderName: user.fullName || 'Brand Partner',
        status: 'approved',
      },
    });

    await this.auditLogsService.log({
      userId,
      action: 'BRAND_FUNDING_ACCOUNT_CONFIGURED',
      entityType: 'BankDetails',
      entityId: bankDetails.id,
      details: { bankName: bankDetails.bankName, mask, routingNumber },
    });

    return {
      success: true,
      bankDetails,
    };
  }

  async createPlaidProcessorToken(userId: string, processor = 'cybrid') {
    const bankDetails = await this.prisma.bankDetails.findUnique({ where: { userId } });
    if (!bankDetails || !bankDetails.plaidAccessToken || !bankDetails.plaidAccountId) {
      throw new NotFoundException(`Plaid verified bank details not found for user ${userId}`);
    }

    const decryptedAccessToken = decryptText(bankDetails.plaidAccessToken);
    const decryptedAccountId = decryptText(bankDetails.plaidAccountId);

    const processorToken = await this.plaidProvider.createProcessorToken(
      decryptedAccessToken,
      decryptedAccountId,
      processor,
    );

    return { processorToken };
  }
}

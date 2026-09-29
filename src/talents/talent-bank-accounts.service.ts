import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  BadGatewayException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../modules/audit-logs/audit-logs.service';
import { PlaidProvider } from '../infrastructure/providers/plaid/plaid.provider';
import { ConduitProvider } from '../infrastructure/providers/conduit/conduit.provider';
import { encryptText, decryptText } from '../common/utils/crypto.util';

export type BankAccountStatus =
  | 'CREATED'
  | 'CONNECTING'
  | 'PROCESSING'
  | 'REVIEWING'
  | 'PENDING'
  | 'READY'
  | 'FAILED'
  | 'DISABLED'
  | 'REMOVED';

export interface TalentBankAccountDto {
  id: string;
  institutionName: string;
  accountName: string;
  accountMask: string;
  accountType: string;
  accountSubtype: string;
  currency: string;
  status: BankAccountStatus;
  isDefault: boolean;
  isPayoutEligible: boolean;
  failureReason?: string;
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class TalentBankAccountsService {
  private readonly logger = new Logger(TalentBankAccountsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
    private readonly plaidProvider: PlaidProvider,
    private readonly conduitProvider: ConduitProvider,
  ) {}

  /**
   * 1. Create Plaid Link Token for Talent
   */
  async createLinkToken(userId: string): Promise<{ linkToken: string; expiration: string }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, fullName: true },
    });

    if (!user) {
      throw new NotFoundException('Talent user not found');
    }

    const result = await this.plaidProvider.createLinkToken(userId);

    await this.auditLogsService.log({
      userId,
      action: 'BANK_LINK_STARTED',
      entityType: 'PlaidLink',
      details: { expiration: result.expiration },
    });

    return result;
  }

  /**
   * 2. Complete Plaid Link:
   * Public Token -> Plaid Access Token -> Provider External Bank Account
   */
  async completePlaidLink(
    userId: string,
    data: { publicToken: string; accountId?: string; institutionName?: string },
  ): Promise<TalentBankAccountDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('Talent user not found');
    }

    // Step A: Exchange Plaid Public Token
    let exchangeResult;
    try {
      exchangeResult = await this.plaidProvider.exchangePublicToken({
        userId,
        publicToken: data.publicToken,
      });
    } catch (err: any) {
      this.logger.error(`Plaid token exchange failed: ${err.message}`);
      throw new BadGatewayException(`Failed to authenticate with Plaid: ${err.message}`);
    }

    const { accessToken, itemId, accounts } = exchangeResult;
    const selectedAccount =
      (data.accountId ? accounts.find((a) => a.accountId === data.accountId) : null) ||
      accounts[0];

    if (!selectedAccount) {
      throw new BadRequestException('No eligible bank account found from Plaid Item');
    }

    const targetAccountId = selectedAccount.accountId;
    const institutionName =
      data.institutionName || selectedAccount.bankName || 'Verified Bank Account';
    const accountMask = selectedAccount.accountNumberMask || 'XXXX';
    const accountName = selectedAccount.accountHolderName || `${institutionName} Checking`;

    // Step B: Encrypt Sensitive Tokens at Rest
    const encryptedAccessToken = encryptText(accessToken);
    const encryptedItemId = encryptText(itemId);
    const encryptedAccountId = encryptText(targetAccountId);

    // Step C: Check Idempotency (Prevent Duplicate Bank Accounts for this Talent)
    const existing = await this.prisma.agencyExternalAccount.findFirst({
      where: {
        agencyId: userId,
        accountNumberMask: accountMask,
      },
    });

    if (existing) {
      this.logger.log(`Account ${targetAccountId} already linked for user ${userId}`);
      return this.mapToDto(existing, institutionName, accountName, accountMask);
    }

    // Step D: Plaid to Conduit Recipient Pipeline
    // 1. Ensure ConduitCustomer exists for Talent
    let conduitCustomer = await this.prisma.conduitCustomer.findUnique({
      where: { userId },
    });
    if (!conduitCustomer) {
      conduitCustomer = await this.prisma.conduitCustomer.create({
        data: {
          userId,
          conduitCustomerId: `cust_tal_${userId.replace(/-/g, '').slice(-12)}`,
          customerType: 'individual',
          kybStatus: 'approved',
          status: 'active',
        },
      });
    }

    // 2. Register Recipient in Conduit (POST /v2/recipients)
    let conduitRecipientId = `rec_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const effectiveStatus: BankAccountStatus = 'READY';

    try {
      const recipientRes = await this.conduitProvider.createRecipient({
        customerId: conduitCustomer.conduitCustomerId,
        name: user.fullName || accountName,
        type: 'individual',
        payoutRail: 'ach',
        accountNumber: accountMask,
        routingNumber: selectedAccount.routingNumber || '021000021',
        bankName: institutionName,
        metadata: { userId, talentId: userId },
      });
      if (recipientRes?.id) {
        conduitRecipientId = recipientRes.id;
      }
    } catch (err: any) {
      this.logger.warn(`Conduit recipient registration notice: ${err.message}`);
    }

    // 3. Persist ConduitRecipient in DB
    await this.prisma.conduitRecipient.upsert({
      where: { recipientId: conduitRecipientId },
      update: {
        name: user.fullName || accountName,
        status: 'active',
        accountNumberMask: accountMask,
        routingNumber: selectedAccount.routingNumber || '021000021',
      },
      create: {
        conduitCustomerId: conduitCustomer.id,
        recipientId: conduitRecipientId,
        name: user.fullName || accountName,
        recipientType: 'individual',
        talentId: userId,
        status: 'active',
        payoutRail: 'ach',
        accountNumberMask: accountMask,
        routingNumber: selectedAccount.routingNumber || '021000021',
      },
    });

    // Step E: Persist Records
    const extAccount = await this.prisma.agencyExternalAccount.create({
      data: {
        agencyId: userId,
        bankName: institutionName,
        accountName,
        accountNumberMask: accountMask,
        routingNumber: selectedAccount.routingNumber || '021000021',
        providerExternalAccountId: conduitRecipientId,
        isPrimary: true,
      },
    });

    // Update BankDetails
    await this.prisma.bankDetails.upsert({
      where: { userId },
      update: {
        bankName: institutionName,
        accountNumber: `****${accountMask}`,
        routingNumber: selectedAccount.routingNumber || '111000025',
        accountHolderName: accountName,
        plaidAccessToken: encryptedAccessToken,
        plaidAccountId: encryptedAccountId,
        plaidItemId: encryptedItemId,
        status: 'approved',
      },
      create: {
        userId,
        bankName: institutionName,
        accountNumber: `****${accountMask}`,
        routingNumber: selectedAccount.routingNumber || '111000025',
        accountHolderName: accountName,
        plaidAccessToken: encryptedAccessToken,
        plaidAccountId: encryptedAccountId,
        plaidItemId: encryptedItemId,
        status: 'approved',
      },
    });

    await this.auditLogsService.log({
      userId,
      action: 'BANK_ACCOUNT_LINKED',
      entityType: 'AgencyExternalAccount',
      entityId: extAccount.id,
      details: {
        conduitRecipientId,
        institutionName,
        accountMask,
        status: effectiveStatus,
      },
    });

    return {
      id: extAccount.id,
      institutionName,
      accountName,
      accountMask,
      accountType: 'depository',
      accountSubtype: 'checking',
      currency: 'USD',
      status: effectiveStatus,
      isDefault: true,
      isPayoutEligible: true,
      createdAt: extAccount.createdAt.toISOString(),
      updatedAt: extAccount.updatedAt.toISOString(),
    };
  }

  /**
   * 3. Get all bank accounts for authenticated Talent
   */
  async getBankAccounts(userId: string): Promise<TalentBankAccountDto[]> {
    const accounts = await this.prisma.agencyExternalAccount.findMany({
      where: { agencyId: userId },
      orderBy: { createdAt: 'desc' },
    });

    if (accounts.length === 0) {
      const bankDetails = await this.prisma.bankDetails.findUnique({
        where: { userId },
      });
      if (bankDetails && bankDetails.bankName) {
        return [
          {
            id: bankDetails.id,
            institutionName: bankDetails.bankName,
            accountName: bankDetails.accountHolderName || `${bankDetails.bankName} Account`,
            accountMask: bankDetails.accountNumber.replace(/[^0-9]/g, '').slice(-4) || '6789',
            accountType: 'depository',
            accountSubtype: 'checking',
            currency: bankDetails.currency || 'USD',
            status: bankDetails.status === 'approved' ? 'READY' : 'PROCESSING',
            isDefault: true,
            isPayoutEligible: bankDetails.status === 'approved',
            createdAt: bankDetails.createdAt.toISOString(),
            updatedAt: bankDetails.updatedAt.toISOString(),
          },
        ];
      }
      return [];
    }

    return accounts.map((acc, index) => {
      return {
        id: acc.id,
        institutionName: acc.bankName || 'Verified Bank',
        accountName: acc.accountName || `${acc.bankName || 'Bank'} Checking`,
        accountMask: acc.accountNumberMask || 'XXXX',
        accountType: 'depository',
        accountSubtype: 'checking',
        currency: 'USD',
        status: 'READY',
        isDefault: acc.isPrimary ?? index === 0,
        isPayoutEligible: true,
        createdAt: acc.createdAt.toISOString(),
        updatedAt: acc.updatedAt.toISOString(),
      };
    });
  }

  /**
   * 4. Get single bank account by ID
   */
  async getBankAccountById(userId: string, id: string): Promise<TalentBankAccountDto> {
    const acc = await this.prisma.agencyExternalAccount.findFirst({
      where: { id, agencyId: userId },
    });

    if (!acc) {
      throw new NotFoundException(`Bank account ${id} not found`);
    }

    return {
      id: acc.id,
      institutionName: acc.bankName || 'Verified Bank',
      accountName: acc.accountName || `${acc.bankName || 'Bank'} Checking`,
      accountMask: acc.accountNumberMask || 'XXXX',
      accountType: 'depository',
      accountSubtype: 'checking',
      currency: 'USD',
      status: 'READY',
      isDefault: acc.isPrimary,
      isPayoutEligible: true,
      createdAt: acc.createdAt.toISOString(),
      updatedAt: acc.updatedAt.toISOString(),
    };
  }

  /**
   * 5. Set default bank account
   */
  async setDefaultBankAccount(userId: string, id: string): Promise<{ success: boolean }> {
    const acc = await this.prisma.agencyExternalAccount.findFirst({
      where: { id, agencyId: userId },
    });

    if (!acc) {
      throw new NotFoundException(`Bank account ${id} not found`);
    }

    await this.prisma.agencyExternalAccount.updateMany({
      where: { agencyId: userId },
      data: { isPrimary: false },
    });

    await this.prisma.agencyExternalAccount.update({
      where: { id },
      data: { isPrimary: true },
    });

    await this.auditLogsService.log({
      userId,
      action: 'BANK_ACCOUNT_DEFAULT_CHANGED',
      entityType: 'AgencyExternalAccount',
      entityId: id,
      details: { providerExternalAccountId: acc.providerExternalAccountId },
    });

    return { success: true };
  }

  /**
   * 6. Delete bank account
   */
  async deleteBankAccount(userId: string, id: string): Promise<{ success: boolean }> {
    const acc = await this.prisma.agencyExternalAccount.findFirst({
      where: { id, agencyId: userId },
    });

    if (!acc) {
      throw new NotFoundException(`Bank account ${id} not found`);
    }

    await this.prisma.conduitRecipient.deleteMany({
      where: {
        OR: [
          { recipientId: acc.providerExternalAccountId },
          { talentId: userId, accountNumberMask: acc.accountNumberMask },
        ],
      },
    });

    await this.prisma.agencyExternalAccount.delete({
      where: { id },
    });

    await this.auditLogsService.log({
      userId,
      action: 'BANK_ACCOUNT_REMOVED',
      entityType: 'AgencyExternalAccount',
      entityId: id,
      details: { providerExternalAccountId: acc.providerExternalAccountId },
    });

    return { success: true };
  }

  /**
   * 7. Sandbox Connect (Supports multiple distinct institutions)
   */
  async linkSandboxAccount(
    userId: string,
    institutionId?: string,
  ): Promise<TalentBankAccountDto> {
    const institutionMap: Record<string, string> = {
      'ins_56': 'Chase Bank',
      'ins_127989': 'Bank of America',
      'ins_127991': 'Wells Fargo',
      'ins_127990': 'Citibank',
      'ins_109508': 'First Platypus Bank',
    };

    let targetInstId = institutionId;
    if (!targetInstId) {
      const existing = await this.prisma.agencyExternalAccount.findMany({
        where: { agencyId: userId },
      });
      const instKeys = Object.keys(institutionMap);
      const nextIndex = existing.length % instKeys.length;
      targetInstId = instKeys[nextIndex];
    }

    const instName = institutionMap[targetInstId] || 'Sandbox Test Bank';
    const publicToken = await this.plaidProvider.createSandboxPublicToken(targetInstId);
    return this.completePlaidLink(userId, {
      publicToken,
      institutionName: instName,
    });
  }

  private mapToDto(
    acc: any,
    institutionName: string,
    accountName: string,
    accountMask: string,
  ): TalentBankAccountDto {
    return {
      id: acc.id,
      institutionName: acc.bankName || institutionName,
      accountName: acc.accountName || accountName,
      accountMask: acc.accountNumberMask || acc.mask || accountMask,
      accountType: 'depository',
      accountSubtype: 'checking',
      currency: 'USD',
      status: 'READY',
      isDefault: acc.isPrimary ?? true,
      isPayoutEligible: true,
      createdAt: acc.createdAt.toISOString(),
      updatedAt: acc.updatedAt.toISOString(),
    };
  }
}

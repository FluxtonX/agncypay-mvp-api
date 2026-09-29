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
    const existing = await this.prisma.cybridExternalBankAccount.findFirst({
      where: {
        agencyUserId: userId,
        plaidInstitutionId: targetAccountId,
      },
    });

    if (existing && existing.status !== 'failed' && existing.status !== 'deleted') {
      this.logger.log(`Account ${targetAccountId} already linked for user ${userId}`);
      return this.mapToDto(existing, institutionName, accountName, accountMask);
    }

    // Step D: Generate provider bank account reference
    // TODO: Wire Conduit Financial Provider adapter bank provisioning here
    const providerExternalBankGuid = `eba_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const effectiveStatus: BankAccountStatus = 'READY';

    // Step E: Persist Records
    const extAccount = await this.prisma.cybridExternalBankAccount.create({
      data: {
        cybridExternalBankGuid: providerExternalBankGuid,
        agencyUserId: userId,
        bankName: institutionName,
        mask: accountMask,
        accountKind: 'plaid_processor_token',
        plaidInstitutionId: targetAccountId,
        asset: 'USD',
        status: 'completed',
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

    // Sync AgencyExternalAccount for compatibility
    await this.prisma.agencyExternalAccount.upsert({
      where: { providerExternalAccountId: providerExternalBankGuid },
      update: {
        accountName,
        bankName: institutionName,
        accountNumberMask: accountMask,
        routingNumber: selectedAccount.routingNumber || '111000025',
        isPrimary: true,
      },
      create: {
        agencyId: userId,
        accountName,
        bankName: institutionName,
        accountNumberMask: accountMask,
        routingNumber: selectedAccount.routingNumber || '111000025',
        providerExternalAccountId: providerExternalBankGuid,
        isPrimary: true,
      },
    });

    await this.auditLogsService.log({
      userId,
      action: 'BANK_ACCOUNT_LINKED',
      entityType: 'ExternalBankAccount',
      entityId: extAccount.id,
      details: {
        providerExternalBankGuid,
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
    const accounts = await this.prisma.cybridExternalBankAccount.findMany({
      where: { agencyUserId: userId, status: { not: 'deleted' } },
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
      const isReady = acc.status === 'completed' || acc.status === 'READY';
      return {
        id: acc.id,
        institutionName: acc.bankName || 'Verified Bank',
        accountName: `${acc.bankName || 'Bank'} Checking`,
        accountMask: acc.mask || 'XXXX',
        accountType: 'depository',
        accountSubtype: 'checking',
        currency: acc.asset || 'USD',
        status: isReady ? 'READY' : acc.status === 'failed' ? 'FAILED' : 'PROCESSING',
        isDefault: index === 0,
        isPayoutEligible: isReady,
        failureReason: acc.failureCode || undefined,
        createdAt: acc.createdAt.toISOString(),
        updatedAt: acc.updatedAt.toISOString(),
      };
    });
  }

  /**
   * 4. Get single bank account by ID
   */
  async getBankAccountById(userId: string, id: string): Promise<TalentBankAccountDto> {
    const acc = await this.prisma.cybridExternalBankAccount.findFirst({
      where: { id, agencyUserId: userId },
    });

    if (!acc) {
      throw new NotFoundException(`Bank account ${id} not found`);
    }

    const isReady = acc.status === 'completed' || acc.status === 'READY';
    return {
      id: acc.id,
      institutionName: acc.bankName || 'Verified Bank',
      accountName: `${acc.bankName || 'Bank'} Checking`,
      accountMask: acc.mask || 'XXXX',
      accountType: 'depository',
      accountSubtype: 'checking',
      currency: acc.asset || 'USD',
      status: isReady ? 'READY' : acc.status === 'failed' ? 'FAILED' : 'PROCESSING',
      isDefault: true,
      isPayoutEligible: isReady,
      failureReason: acc.failureCode || undefined,
      createdAt: acc.createdAt.toISOString(),
      updatedAt: acc.updatedAt.toISOString(),
    };
  }

  /**
   * 5. Set default bank account
   */
  async setDefaultBankAccount(userId: string, id: string): Promise<{ success: boolean }> {
    const acc = await this.prisma.cybridExternalBankAccount.findFirst({
      where: { id, agencyUserId: userId },
    });

    if (!acc) {
      throw new NotFoundException(`Bank account ${id} not found`);
    }

    await this.prisma.agencyExternalAccount.updateMany({
      where: { agencyId: userId },
      data: { isPrimary: false },
    });

    await this.prisma.agencyExternalAccount.updateMany({
      where: { agencyId: userId, providerExternalAccountId: acc.cybridExternalBankGuid },
      data: { isPrimary: true },
    });

    await this.auditLogsService.log({
      userId,
      action: 'BANK_ACCOUNT_DEFAULT_CHANGED',
      entityType: 'ExternalBankAccount',
      entityId: id,
      details: { providerExternalAccountId: acc.cybridExternalBankGuid },
    });

    return { success: true };
  }

  /**
   * 6. Delete bank account
   */
  async deleteBankAccount(userId: string, id: string): Promise<{ success: boolean }> {
    const acc = await this.prisma.cybridExternalBankAccount.findFirst({
      where: { id, agencyUserId: userId },
    });

    if (!acc) {
      throw new NotFoundException(`Bank account ${id} not found`);
    }

    await this.prisma.cybridExternalBankAccount.update({
      where: { id },
      data: { status: 'deleted' },
    });

    await this.prisma.agencyExternalAccount.deleteMany({
      where: { agencyId: userId, providerExternalAccountId: acc.cybridExternalBankGuid },
    });

    await this.auditLogsService.log({
      userId,
      action: 'BANK_ACCOUNT_REMOVED',
      entityType: 'ExternalBankAccount',
      entityId: id,
      details: { providerExternalAccountId: acc.cybridExternalBankGuid },
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
      const existing = await this.prisma.cybridExternalBankAccount.findMany({
        where: { agencyUserId: userId, status: { not: 'deleted' } },
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
    const isReady = acc.status === 'completed' || acc.status === 'READY';
    return {
      id: acc.id,
      institutionName: acc.bankName || institutionName,
      accountName,
      accountMask: acc.mask || accountMask,
      accountType: 'depository',
      accountSubtype: 'checking',
      currency: acc.asset || 'USD',
      status: isReady ? 'READY' : 'PROCESSING',
      isDefault: true,
      isPayoutEligible: isReady,
      createdAt: acc.createdAt.toISOString(),
      updatedAt: acc.updatedAt.toISOString(),
    };
  }
}

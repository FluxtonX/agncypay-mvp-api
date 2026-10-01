import {
  BadGatewayException,
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { FinancialAccount } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../modules/audit-logs/audit-logs.service';
import { PlaidProvider } from '../infrastructure/providers/plaid/plaid.provider';
import { PAYMENT_PROVIDER } from '../core/interfaces/payment-provider.interface';
import type { PaymentProvider } from '../core/interfaces/payment-provider.interface';
import { encryptText } from '../common/utils/crypto.util';

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
    private readonly plaidProvider: PlaidProvider,
    @Inject(PAYMENT_PROVIDER) private readonly paymentProvider: PaymentProvider,
  ) {}

  private async participantId(userId: string) {
    const link = await this.prisma.participantUser.findUnique({
      where: { userId },
    });
    if (!link)
      throw new NotFoundException('Talent participant identity not found');
    return link.participantId;
  }

  private mapAccount(account: FinancialAccount): TalentBankAccountDto {
    return {
      id: account.id,
      institutionName: account.institutionName || 'Verified Bank',
      accountName: account.displayName || 'Bank account',
      accountMask: account.lastFour || 'XXXX',
      accountType: 'depository',
      accountSubtype: String(
        (account.metadata as Record<string, unknown>)?.subtype || 'checking',
      ),
      currency: account.currency,
      status:
        account.status === 'ready'
          ? 'READY'
          : account.status === 'disabled'
            ? 'DISABLED'
            : 'PROCESSING',
      isDefault: account.isPrimary,
      isPayoutEligible: account.status === 'ready' && !account.deletedAt,
      createdAt: account.createdAt.toISOString(),
      updatedAt: account.updatedAt.toISOString(),
    };
  }

  async createLinkToken(
    userId: string,
  ): Promise<{ linkToken: string; expiration: string }> {
    await this.participantId(userId);
    const result = await this.plaidProvider.createLinkToken(userId);
    await this.auditLogsService.log({
      userId,
      action: 'BANK_LINK_STARTED',
      entityType: 'Participant',
      details: { expiration: result.expiration },
    });
    return result;
  }

  async completePlaidLink(
    userId: string,
    data: { publicToken: string; accountId?: string; institutionName?: string },
  ): Promise<TalentBankAccountDto> {
    const participantId = await this.participantId(userId);
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Talent user not found');
    const exchange = await this.plaidProvider.exchangePublicToken({
      userId,
      publicToken: data.publicToken,
    });
    const selected = data.accountId
      ? exchange.accounts.find(
          (account) => account.accountId === data.accountId,
        )
      : exchange.accounts[0];
    if (!selected)
      throw new BadRequestException(
        'No eligible Plaid bank account was selected',
      );
    if (!selected.accountNumber || !selected.routingNumber) {
      throw new BadRequestException(
        'Selected account does not expose verified ACH account and routing details',
      );
    }
    const institutionName =
      data.institutionName || selected.institutionName || selected.bankName;
    const lastFour =
      selected.accountNumberMask || selected.accountNumber.slice(-4);
    const duplicate = await this.prisma.financialAccount.findFirst({
      where: {
        participantId,
        type: 'external_bank',
        institutionName,
        lastFour,
        currency: 'USD',
        deletedAt: null,
      },
    });
    if (duplicate) return this.mapAccount(duplicate);

    const platformParty = await this.prisma.providerPartyMap.findFirst({
      where: {
        provider: this.paymentProvider.name,
        status: 'active',
        organization: { type: 'platform', status: 'active' },
      },
    });
    if (!platformParty)
      throw new BadRequestException(
        'Platform payout provider identity is not configured',
      );

    let recipient;
    try {
      recipient = await this.paymentProvider.createRecipient({
        partyId: platformParty.externalId,
        name: user.fullName || selected.accountHolderName,
        type: 'individual',
        accountNumber: selected.accountNumber,
        routingNumber: selected.routingNumber,
        payoutRail: 'ach',
        metadata: { participantId, plaidAccountId: selected.accountId },
      });
    } catch (error: any) {
      throw new BadGatewayException(
        `Payment provider bank registration failed: ${error.message}`,
      );
    }

    const account = await this.prisma.$transaction(async (tx) => {
      await tx.financialAccount.updateMany({
        where: {
          participantId,
          type: 'external_bank',
          currency: 'USD',
          deletedAt: null,
        },
        data: { isPrimary: false },
      });
      return tx.financialAccount.create({
        data: {
          participantId,
          type: 'external_bank',
          status: recipient.status === 'active' ? 'ready' : 'pending',
          currency: 'USD',
          country: 'USA',
          displayName: selected.accountName || selected.accountHolderName,
          institutionName,
          lastFour,
          isPrimary: true,
          metadata: {
            subtype: selected.subtype || 'checking',
            plaidAccessTokenEncrypted: encryptText(exchange.accessToken),
            plaidItemIdEncrypted: encryptText(exchange.itemId),
            plaidAccountIdEncrypted: encryptText(selected.accountId),
          },
          providerAccounts: {
            create: {
              provider: this.paymentProvider.name,
              accountType: 'recipient',
              externalId: recipient.id,
              status: recipient.status === 'active' ? 'active' : 'pending',
              metadata: { payoutRail: recipient.payoutRail || 'ach' },
            },
          },
        },
      });
    });
    await this.auditLogsService.log({
      userId,
      action: 'TALENT_BANK_ACCOUNT_LINKED',
      entityType: 'FinancialAccount',
      entityId: account.id,
      details: {
        provider: this.paymentProvider.name,
        institutionName,
        lastFour,
      },
    });
    return this.mapAccount(account);
  }

  async getBankAccounts(userId: string): Promise<TalentBankAccountDto[]> {
    const participantId = await this.participantId(userId);
    const accounts = await this.prisma.financialAccount.findMany({
      where: { participantId, type: 'external_bank', deletedAt: null },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'desc' }],
    });
    return accounts.map((account) => this.mapAccount(account));
  }

  async getBankAccountById(
    userId: string,
    id: string,
  ): Promise<TalentBankAccountDto> {
    const participantId = await this.participantId(userId);
    const account = await this.prisma.financialAccount.findFirst({
      where: { id, participantId, type: 'external_bank', deletedAt: null },
    });
    if (!account) throw new NotFoundException(`Bank account ${id} not found`);
    return this.mapAccount(account);
  }

  async setDefaultBankAccount(
    userId: string,
    id: string,
  ): Promise<{ success: boolean }> {
    const participantId = await this.participantId(userId);
    const account = await this.prisma.financialAccount.findFirst({
      where: {
        id,
        participantId,
        type: 'external_bank',
        status: 'ready',
        deletedAt: null,
      },
    });
    if (!account)
      throw new NotFoundException(`Ready bank account ${id} not found`);
    await this.prisma.$transaction([
      this.prisma.financialAccount.updateMany({
        where: { participantId, type: 'external_bank', deletedAt: null },
        data: { isPrimary: false },
      }),
      this.prisma.financialAccount.update({
        where: { id },
        data: { isPrimary: true },
      }),
    ]);
    await this.auditLogsService.log({
      userId,
      action: 'TALENT_BANK_DEFAULT_CHANGED',
      entityType: 'FinancialAccount',
      entityId: id,
    });
    return { success: true };
  }

  async deleteBankAccount(
    userId: string,
    id: string,
  ): Promise<{ success: boolean }> {
    const participantId = await this.participantId(userId);
    const account = await this.prisma.financialAccount.findFirst({
      where: { id, participantId, type: 'external_bank', deletedAt: null },
    });
    if (!account) throw new NotFoundException(`Bank account ${id} not found`);
    const activeWithdrawal = await this.prisma.paymentInstruction.count({
      where: {
        destinationFinancialAccountId: id,
        instructionType: 'talent_withdrawal',
        status: {
          in: [
            'requested',
            'validated',
            'awaiting_provider',
            'submitted',
            'processing',
          ],
        },
      },
    });
    if (activeWithdrawal)
      throw new BadRequestException('Bank account has an active withdrawal');
    await this.prisma.$transaction([
      this.prisma.providerAccountMap.updateMany({
        where: { financialAccountId: id },
        data: { status: 'closed' },
      }),
      this.prisma.financialAccount.update({
        where: { id },
        data: { status: 'disabled', isPrimary: false, deletedAt: new Date() },
      }),
    ]);
    await this.auditLogsService.log({
      userId,
      action: 'TALENT_BANK_ACCOUNT_REMOVED',
      entityType: 'FinancialAccount',
      entityId: id,
    });
    return { success: true };
  }

  async linkSandboxAccount(
    userId: string,
    institutionId = 'ins_3',
  ): Promise<TalentBankAccountDto> {
    if (process.env.NODE_ENV === 'production') {
      throw new BadRequestException(
        'Sandbox bank linking is unavailable in production',
      );
    }
    const publicToken =
      await this.plaidProvider.createSandboxPublicToken(institutionId);
    return this.completePlaidLink(userId, { publicToken });
  }
}

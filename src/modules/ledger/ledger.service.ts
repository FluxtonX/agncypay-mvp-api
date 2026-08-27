import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { JournalEntry, LedgerAccount } from '@prisma/client';

export interface PostJournalEntryParams {
  debitAccountCode: string;
  creditAccountCode: string;
  amount: number;
  currency?: string;
  referenceType: string;
  referenceId?: string;
  providerReference?: string;
  description: string;
  status?: 'posted' | 'pending' | 'reversed';
}

@Injectable()
export class LedgerService {
  private readonly logger = new Logger(LedgerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  async getOrCreateAccount(params: {
    accountCode: string;
    accountType: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
    name: string;
    ownerId?: string;
    ownerType?: 'brand' | 'agency' | 'system';
    currency?: string;
  }): Promise<LedgerAccount> {
    const existing = await this.prisma.ledgerAccount.findUnique({
      where: { accountCode: params.accountCode },
    });

    if (existing) return existing;

    return this.prisma.ledgerAccount.create({
      data: {
        accountCode: params.accountCode,
        accountType: params.accountType,
        name: params.name,
        ownerId: params.ownerId,
        ownerType: params.ownerType,
        currency: params.currency || 'USD',
      },
    });
  }

  async postJournalEntry(params: PostJournalEntryParams): Promise<JournalEntry> {
    if (params.amount <= 0) {
      throw new BadRequestException('Journal entry amount must be strictly greater than 0');
    }

    if (params.debitAccountCode === params.creditAccountCode) {
      throw new BadRequestException('Debit and credit accounts must be distinct in double-entry bookkeeping');
    }

    // Ensure both accounts exist
    const debitAccount = await this.getOrCreateAccount({
      accountCode: params.debitAccountCode,
      accountType: 'asset',
      name: params.debitAccountCode,
    });

    const creditAccount = await this.getOrCreateAccount({
      accountCode: params.creditAccountCode,
      accountType: 'liability',
      name: params.creditAccountCode,
    });

    // Create immutable journal entry
    const entry = await this.prisma.journalEntry.create({
      data: {
        debitAccountId: debitAccount.id,
        creditAccountId: creditAccount.id,
        amount: params.amount,
        currency: params.currency || 'USD',
        status: params.status || 'posted',
        referenceType: params.referenceType,
        referenceId: params.referenceId,
        providerReference: params.providerReference,
        description: params.description,
      },
    });

    await this.auditLogsService.log({
      userId: debitAccount.ownerId || creditAccount.ownerId || undefined,
      action: 'LEDGER_JOURNAL_POSTED',
      entityType: 'JournalEntry',
      entityId: entry.id,
      details: {
        debit: params.debitAccountCode,
        credit: params.creditAccountCode,
        amount: params.amount,
        currency: params.currency || 'USD',
        referenceType: params.referenceType,
        providerReference: params.providerReference,
      },
    });

    this.logger.log(
      `Posted Journal Entry [${entry.id}]: Debit ${params.debitAccountCode} / Credit ${params.creditAccountCode} Amount: ${params.amount} ${params.currency || 'USD'}`,
    );

    return entry;
  }

  async getAccountBalance(accountCode: string): Promise<{
    accountCode: string;
    debitTotal: number;
    creditTotal: number;
    balance: number;
    currency: string;
  }> {
    const account = await this.prisma.ledgerAccount.findUnique({
      where: { accountCode },
    });

    if (!account) {
      return { accountCode, debitTotal: 0, creditTotal: 0, balance: 0, currency: 'USD' };
    }

    const debits = await this.prisma.journalEntry.aggregate({
      where: { debitAccountId: account.id, status: 'posted' },
      _sum: { amount: true },
    });

    const credits = await this.prisma.journalEntry.aggregate({
      where: { creditAccountId: account.id, status: 'posted' },
      _sum: { amount: true },
    });

    const debitTotal = debits._sum.amount || 0;
    const creditTotal = credits._sum.amount || 0;

    // For asset and expense accounts: normal balance is Debit (Debits - Credits)
    // For liability, equity, and revenue accounts: normal balance is Credit (Credits - Debits)
    const isNormalDebit = ['asset', 'expense'].includes(account.accountType.toLowerCase());
    const balance = isNormalDebit ? debitTotal - creditTotal : creditTotal - debitTotal;

    return {
      accountCode,
      debitTotal,
      creditTotal,
      balance,
      currency: account.currency,
    };
  }

  async getJournalHistory(accountCode?: string, limit = 50): Promise<any[]> {
    if (accountCode) {
      const account = await this.prisma.ledgerAccount.findUnique({ where: { accountCode } });
      if (!account) return [];

      return this.prisma.journalEntry.findMany({
        where: {
          OR: [{ debitAccountId: account.id }, { creditAccountId: account.id }],
        },
        orderBy: { postedAt: 'desc' },
        take: limit,
      });
    }

    return this.prisma.journalEntry.findMany({
      orderBy: { postedAt: 'desc' },
      take: limit,
    });
  }
}

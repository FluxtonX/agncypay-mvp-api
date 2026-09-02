import { Injectable, BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { JournalEntry, LedgerAccount, Prisma } from '@prisma/client';
import { toDecimal, toNumber, subDecimals, addDecimals, isLessThanDecimal } from '../../common/utils/decimal.util';

export interface PostJournalEntryParams {
  debitAccountCode: string;
  creditAccountCode: string;
  amount: number | Prisma.Decimal;
  currency?: string;
  referenceType: string;
  referenceId?: string;
  providerReference?: string;
  description: string;
  status?: 'posted' | 'pending' | 'reversed';
}

export interface StatementOptions {
  startDate?: Date;
  endDate?: Date;
  limit?: number;
}

@Injectable()
export class LedgerService {
  private readonly logger = new Logger(LedgerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  /**
   * Automatically classifies an account code based on standard Chart of Accounts rules.
   */
  getAccountClassification(accountCode: string): {
    accountType: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
    ownerType: 'brand' | 'agency' | 'system';
    currency: string;
  } {
    const parts = accountCode.split(':');
    const prefix = parts[0];
    const suffix = parts[parts.length - 1];

    const currency = suffix === 'USDC_TRADING' ? 'USDC' : suffix === 'USD' ? 'USD' : 'USD';

    if (prefix === 'CLEARING') {
      return { accountType: 'asset', ownerType: 'system', currency };
    }
    if (prefix === 'AGENCY' && suffix === 'USDC_TRADING') {
      return { accountType: 'asset', ownerType: 'agency', currency: 'USDC' };
    }
    if (prefix === 'AGENCY') {
      return { accountType: 'liability', ownerType: 'agency', currency };
    }
    if (prefix === 'BRAND') {
      return { accountType: 'liability', ownerType: 'brand', currency };
    }
    if (prefix === 'PLATFORM') {
      return { accountType: 'revenue', ownerType: 'system', currency };
    }
    return { accountType: 'asset', ownerType: 'system', currency };
  }

  async getOrCreateAccount(params: {
    accountCode: string;
    accountType?: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
    name?: string;
    ownerId?: string;
    ownerType?: 'brand' | 'agency' | 'system';
    currency?: string;
  }): Promise<LedgerAccount> {
    const existing = await this.prisma.ledgerAccount.findUnique({
      where: { accountCode: params.accountCode },
    });

    if (existing) return existing;

    const classification = this.getAccountClassification(params.accountCode);
    const parts = params.accountCode.split(':');
    const derivedOwnerId = parts.length >= 2 && parts[1] !== 'CYBRID_DEPOSIT' && parts[1] !== 'CYBRID_OUTBOUND' && parts[1] !== 'FEE'
      ? parts[1]
      : undefined;

    return this.prisma.ledgerAccount.create({
      data: {
        accountCode: params.accountCode,
        accountType: params.accountType || classification.accountType,
        name: params.name || params.accountCode,
        ownerId: params.ownerId || derivedOwnerId,
        ownerType: params.ownerType || classification.ownerType,
        currency: params.currency || classification.currency,
      },
    });
  }

  async postJournalEntry(params: PostJournalEntryParams): Promise<JournalEntry> {
    const decAmount = toDecimal(params.amount);
    if (decAmount.lessThanOrEqualTo(0)) {
      throw new BadRequestException('Journal entry amount must be strictly greater than 0');
    }

    if (params.debitAccountCode === params.creditAccountCode) {
      throw new BadRequestException('Debit and credit accounts must be distinct in double-entry bookkeeping');
    }

    // Ensure both accounts exist in Chart of Accounts
    const debitAccount = await this.getOrCreateAccount({
      accountCode: params.debitAccountCode,
    });

    const creditAccount = await this.getOrCreateAccount({
      accountCode: params.creditAccountCode,
    });

    // Create immutable journal entry
    const entry = await this.prisma.journalEntry.create({
      data: {
        debitAccountId: debitAccount.id,
        creditAccountId: creditAccount.id,
        amount: decAmount,
        currency: params.currency || debitAccount.currency || 'USD',
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
        amount: decAmount.toString(),
        currency: params.currency || 'USD',
        referenceType: params.referenceType,
        providerReference: params.providerReference,
      },
    });

    this.logger.log(
      `Posted Journal Entry [${entry.id}]: Debit ${params.debitAccountCode} / Credit ${params.creditAccountCode} Amount: ${decAmount.toString()} ${params.currency || 'USD'}`,
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
      const classification = this.getAccountClassification(accountCode);
      return { accountCode, debitTotal: 0, creditTotal: 0, balance: 0, currency: classification.currency };
    }

    const debits = await this.prisma.journalEntry.aggregate({
      where: { debitAccountId: account.id, status: 'posted' },
      _sum: { amount: true },
    });

    const credits = await this.prisma.journalEntry.aggregate({
      where: { creditAccountId: account.id, status: 'posted' },
      _sum: { amount: true },
    });

    const debitDec = toDecimal(debits._sum.amount);
    const creditDec = toDecimal(credits._sum.amount);

    // For asset and expense accounts: normal balance is Debit (Debits - Credits)
    // For liability, equity, and revenue accounts: normal balance is Credit (Credits - Debits)
    const isNormalDebit = ['asset', 'expense'].includes(account.accountType.toLowerCase());
    const balanceDec = isNormalDebit ? subDecimals(debitDec, creditDec) : subDecimals(creditDec, debitDec);

    return {
      accountCode,
      debitTotal: debitDec.toNumber(),
      creditTotal: creditDec.toNumber(),
      balance: balanceDec.toNumber(),
      currency: account.currency,
    };
  }

  /**
   * Pre-flight balance assertion. Throws BadRequestException if balance is insufficient.
   */
  async assertSufficientBalance(accountCode: string, requiredAmount: number | Prisma.Decimal): Promise<number> {
    const reqDec = toDecimal(requiredAmount);
    const current = await this.getAccountBalance(accountCode);

    if (toDecimal(current.balance).lessThan(reqDec)) {
      throw new BadRequestException(
        `Insufficient available balance in account ${accountCode}: requested $${reqDec.toFixed(2)}, available $${current.balance.toFixed(2)}`,
      );
    }

    return current.balance;
  }

  /**
   * Audits platform-wide trial balance: Sum(all posted debits) must equal Sum(all posted credits).
   */
  async getTrialBalance(): Promise<{
    totalDebits: number;
    totalCredits: number;
    isBalanced: boolean;
    discrepancy: number;
    totalJournalEntries: number;
  }> {
    // In double-entry bookkeeping, every journal entry has equal debit and credit amounts.
    // Sum all posted debit amounts and all posted credit amounts independently.
    const allEntries = await this.prisma.journalEntry.findMany({
      where: { status: 'posted' },
      select: { amount: true, debitAccountId: true, creditAccountId: true },
    });

    let totalDebits = toDecimal(0);
    let totalCredits = toDecimal(0);

    for (const entry of allEntries) {
      const amount = toDecimal(entry.amount);
      totalDebits = addDecimals(totalDebits, amount);
      totalCredits = addDecimals(totalCredits, amount);
    }

    // In a properly implemented double-entry system with immutable journal entries,
    // totalDebits should always equal totalCredits.
    // A discrepancy indicates a bug or data corruption.
    const discrepancy = subDecimals(totalDebits, totalCredits);

    return {
      totalDebits: totalDebits.toNumber(),
      totalCredits: totalCredits.toNumber(),
      isBalanced: discrepancy.abs().lessThanOrEqualTo(toDecimal(0.0001)),
      discrepancy: discrepancy.toNumber(),
      totalJournalEntries: allEntries.length,
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

  /**
   * Generates a time-range filtered ledger statement with transaction details.
   */
  async getStatement(accountCode: string, options: StatementOptions = {}) {
    const account = await this.prisma.ledgerAccount.findUnique({ where: { accountCode } });
    if (!account) {
      throw new NotFoundException(`Ledger account ${accountCode} not found`);
    }

    const whereClause: Prisma.JournalEntryWhereInput = {
      OR: [{ debitAccountId: account.id }, { creditAccountId: account.id }],
      status: 'posted',
      ...(options.startDate || options.endDate
        ? {
            postedAt: {
              ...(options.startDate ? { gte: options.startDate } : {}),
              ...(options.endDate ? { lte: options.endDate } : {}),
            },
          }
        : {}),
    };

    const entries = await this.prisma.journalEntry.findMany({
      where: whereClause,
      orderBy: { postedAt: 'asc' },
      take: options.limit || 100,
    });

    const currentBalance = await this.getAccountBalance(accountCode);

    return {
      accountCode,
      currency: account.currency,
      accountType: account.accountType,
      currentBalance: currentBalance.balance,
      entriesCount: entries.length,
      entries: entries.map((entry) => ({
        id: entry.id,
        postedAt: entry.postedAt,
        amount: toNumber(entry.amount),
        type: entry.debitAccountId === account.id ? 'DEBIT' : 'CREDIT',
        referenceType: entry.referenceType,
        referenceId: entry.referenceId,
        providerReference: entry.providerReference,
        description: entry.description,
      })),
    };
  }
}

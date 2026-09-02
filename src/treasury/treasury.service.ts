import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../modules/audit-logs/audit-logs.service';
import { LedgerService } from '../modules/ledger/ledger.service';
import { toDecimal, toNumber, addDecimals } from '../common/utils/decimal.util';

@Injectable()
export class TreasuryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
    private readonly ledgerService: LedgerService,
  ) {}

  async getBalance(userId: string) {
    const accountCode = `BRAND:${userId}:PREPAID`;
    const ledgerBal = await this.ledgerService.getAccountBalance(accountCode);

    return {
      userId,
      accountCode,
      balance: ledgerBal.balance,
      currency: ledgerBal.currency,
      debitTotal: ledgerBal.debitTotal,
      creditTotal: ledgerBal.creditTotal,
    };
  }

  async recordDeposit(userId: string, amount: number, paymentMethod: string) {
    const decAmount = toDecimal(amount);
    if (decAmount.lessThanOrEqualTo(0)) {
      throw new BadRequestException('Deposit amount must be strictly greater than 0');
    }

    // 1. Post double-entry journal entry
    // Debit: Clearing account (inbound funds received)
    // Credit: Brand Prepaid liability account (available for brand to spend)
    const journalEntry = await this.ledgerService.postJournalEntry({
      debitAccountCode: 'CLEARING:CYBRID_DEPOSIT:USD',
      creditAccountCode: `BRAND:${userId}:PREPAID`,
      amount: decAmount,
      currency: 'USD',
      referenceType: 'BRAND_TREASURY_DEPOSIT',
      referenceId: userId,
      description: `Brand treasury pre-funding deposit via ${paymentMethod}`,
    });

    const currentBal = await this.ledgerService.getAccountBalance(`BRAND:${userId}:PREPAID`);

    // 2. Sync read-cache BrandTreasury record
    const updatedTreasury = await this.prisma.brandTreasury.upsert({
      where: { userId },
      update: {
        balance: toDecimal(currentBal.balance),
        lastDepositAmount: decAmount,
        lastDepositMethod: paymentMethod,
        lastUpdated: new Date(),
      },
      create: {
        userId,
        balance: toDecimal(currentBal.balance),
        lastDepositAmount: decAmount,
        lastDepositMethod: paymentMethod,
      },
    });

    await this.auditLogsService.log({
      userId,
      action: 'TREASURY_DEPOSIT',
      entityType: 'BrandTreasury',
      entityId: updatedTreasury.id,
      details: {
        amount: decAmount.toString(),
        paymentMethod,
        newBalance: currentBal.balance,
        journalEntryId: journalEntry.id,
      },
    });

    return {
      ...updatedTreasury,
      balance: currentBal.balance,
      journalEntryId: journalEntry.id,
    };
  }
}

import { Injectable, NotFoundException, BadRequestException, BadGatewayException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../modules/audit-logs/audit-logs.service';
import { LedgerService } from '../modules/ledger/ledger.service';
import { PayoutStateService } from '../modules/payouts/payout-state.service';
import { toDecimal } from '../common/utils/decimal.util';
import { PayoutStatus } from '@prisma/client';
import { ConduitProvider } from '../infrastructure/providers/conduit/conduit.provider';

@Injectable()
export class PayoutsService {
  private readonly logger = new Logger(PayoutsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
    private readonly ledgerService: LedgerService,
    private readonly payoutStateService: PayoutStateService,
    private readonly conduitProvider: ConduitProvider,
  ) {}

  /**
   * ─── 1. Domestic Talent Payout ───────────────────────────────────
   * Agency USD Balance → Atomic Ledger Reservation → Conduit Payout Adapter (TODO)
   */
  async requestDomesticTalentPayout(data: {
    agencyId: string;
    talentId: string;
    amount: number;
    currency?: string;
    paymentId?: string;
    idempotencyKey?: string;
    metadata?: Record<string, any>;
  }) {
    if (data.amount <= 0) {
      throw new BadRequestException('Payout amount must be strictly greater than 0');
    }

    // 1. Check idempotency
    if (data.idempotencyKey) {
      const existing = await this.prisma.paymentPayout.findUnique({
        where: { idempotencyKey: data.idempotencyKey },
      });
      if (existing) {
        this.logger.warn(`Idempotent payout request hit for key ${data.idempotencyKey}`);
        return existing;
      }
    }

    // 2. Validate Agency balance using Decimal comparison
    const agencyAccountCode = `AGENCY:${data.agencyId}:USD`;
    const ledgerBalance = await this.ledgerService.getAccountBalance(agencyAccountCode);
    const availableDec = toDecimal(ledgerBalance.balance);
    const requestedDec = toDecimal(data.amount);

    if (availableDec.lessThan(requestedDec)) {
      throw new BadRequestException(
        `Insufficient available Agency balance ($${availableDec.toFixed(2)}) for payout of $${requestedDec.toFixed(2)}`,
      );
    }

    // 3. Resolve Talent & Counterparty & External Bank
    const talent = await this.prisma.user.findFirst({
      where: { id: data.talentId, accountType: 'talent', deletedAt: null },
      include: {
        talentCounterparties: {
          include: { externalBankAccounts: true },
        },
      },
    });

    if (!talent) {
      throw new NotFoundException(`Talent ${data.talentId} not found`);
    }

    const counterparty = talent.talentCounterparties[0];
    const externalBank = counterparty?.externalBankAccounts[0];
    const destinationGuid = externalBank?.cybridExternalBankGuid || `dest_${Date.now()}`;

    const payoutNumber = `PO-DOM-${Math.floor(100000 + Math.random() * 900000)}`;

    // 4. ATOMIC: Create payout record + reserve funds via pending journal entry in a transaction
    const payout = await this.prisma.$transaction(async (tx) => {
      // Re-check balance inside transaction for concurrency safety
      const account = await tx.ledgerAccount.findUnique({
        where: { accountCode: agencyAccountCode },
      });

      if (account) {
        const debits = await tx.journalEntry.aggregate({
          where: { debitAccountId: account.id, status: { in: ['posted', 'pending'] } },
          _sum: { amount: true },
        });
        const credits = await tx.journalEntry.aggregate({
          where: { creditAccountId: account.id, status: { in: ['posted', 'pending'] } },
          _sum: { amount: true },
        });
        const debitDec = toDecimal(debits._sum.amount);
        const creditDec = toDecimal(credits._sum.amount);
        const effectiveBalance = creditDec.minus(debitDec);

        if (effectiveBalance.lessThan(requestedDec)) {
          throw new BadRequestException(
            `Insufficient balance after considering pending reservations: $${effectiveBalance.toFixed(2)} available`,
          );
        }
      }

      // Create payout record
      const newPayout = await tx.paymentPayout.create({
        data: {
          payoutNumber,
          agencyId: data.agencyId,
          talentId: data.talentId,
          paymentId: data.paymentId,
          amount: data.amount as any,
          currency: data.currency || 'USD',
          payoutType: 'domestic',
          status: 'RESERVED',
          destinationAccountGuid: destinationGuid,
          idempotencyKey: data.idempotencyKey,
          metadata: data.metadata || {},
        },
      });

      // Post PENDING journal entry (reservation)
      const debitAccount = await this.ledgerService.getOrCreateAccount({ accountCode: agencyAccountCode });
      const creditAccount = await this.ledgerService.getOrCreateAccount({ accountCode: `CLEARING:OUTBOUND_PAYOUT:USD` });

      await tx.journalEntry.create({
        data: {
          debitAccountId: debitAccount.id,
          creditAccountId: creditAccount.id,
          amount: requestedDec,
          currency: data.currency || 'USD',
          status: 'pending',
          referenceType: 'DOMESTIC_TALENT_PAYOUT',
          referenceId: newPayout.id,
          description: `[PENDING] Domestic payout ${payoutNumber} reservation for Talent ${talent.fullName}`,
        },
      });

      return newPayout;
    });

    // 5. Conduit Sandbox Live Rail Execution
    await this.payoutStateService.transition(payout.id, 'TRANSFER_PENDING');

    try {
      const beneficiaryId = externalBank?.cybridExternalBankGuid || `ben_${Date.now()}`;
      const transfer = await this.conduitProvider.createTransfer({
        beneficiaryId,
        amount: data.amount,
        currency: data.currency || 'USD',
        reference: payoutNumber,
        metadata: {
          agencyId: data.agencyId,
          talentId: data.talentId,
          payoutNumber,
          payoutId: payout.id,
        },
        idempotencyKey: data.idempotencyKey || payout.id,
      });

      await this.prisma.paymentPayout.update({
        where: { id: payout.id },
        data: {
          cybridTransferGuid: transfer.id,
          status: transfer.status === 'completed' ? 'COMPLETED' : 'PROCESSING',
        },
      });

      if (transfer.status === 'completed') {
        await this.payoutStateService.transition(payout.id, 'COMPLETED');
      }
    } catch (conduitErr: any) {
      this.logger.warn(`Conduit sandbox execution notice: ${conduitErr.message}. Marked as PROCESSING.`);
    }

    await this.syncLegacyWalletBalance(data.agencyId);

    await this.auditLogsService.log({
      userId: data.agencyId,
      action: 'DOMESTIC_PAYOUT_INITIATED',
      entityType: 'PaymentPayout',
      entityId: payout.id,
      details: {
        amount: data.amount,
        talentName: talent.fullName,
        payoutNumber,
      },
    });

    return payout;
  }

  /**
   * ─── 2. International Talent Payout ──────────────────────────────
   */
  async requestInternationalTalentPayout(data: {
    agencyId: string;
    talentId: string;
    amount: number;
    destinationCurrency?: string;
    paymentId?: string;
    idempotencyKey?: string;
    metadata?: Record<string, any>;
  }) {
    if (data.amount <= 0) {
      throw new BadRequestException('Payout amount must be greater than 0');
    }

    if (data.idempotencyKey) {
      const existing = await this.prisma.paymentPayout.findUnique({
        where: { idempotencyKey: data.idempotencyKey },
      });
      if (existing) return existing;
    }

    const agencyAccountCode = `AGENCY:${data.agencyId}:USD`;
    const ledgerBalance = await this.ledgerService.getAccountBalance(agencyAccountCode);
    const availableDec = toDecimal(ledgerBalance.balance);
    const requestedDec = toDecimal(data.amount);

    if (availableDec.lessThan(requestedDec)) {
      throw new BadRequestException(
        `Insufficient available balance ($${availableDec.toFixed(2)}) for international payout of $${requestedDec.toFixed(2)}`,
      );
    }

    const talent = await this.prisma.user.findFirst({
      where: { id: data.talentId, accountType: 'talent', deletedAt: null },
      include: {
        talentCounterparties: {
          include: { externalBankAccounts: true },
        },
      },
    });

    if (!talent) throw new NotFoundException(`Talent ${data.talentId} not found`);

    const counterparty = talent.talentCounterparties[0];
    const externalBank = counterparty?.externalBankAccounts[0];
    const destinationGuid = externalBank?.cybridExternalBankGuid || `dest_intl_${Date.now()}`;
    const payoutNumber = `PO-INTL-${Math.floor(100000 + Math.random() * 900000)}`;

    const payout = await this.prisma.$transaction(async (tx) => {
      const account = await tx.ledgerAccount.findUnique({
        where: { accountCode: agencyAccountCode },
      });

      if (account) {
        const debits = await tx.journalEntry.aggregate({
          where: { debitAccountId: account.id, status: { in: ['posted', 'pending'] } },
          _sum: { amount: true },
        });
        const credits = await tx.journalEntry.aggregate({
          where: { creditAccountId: account.id, status: { in: ['posted', 'pending'] } },
          _sum: { amount: true },
        });
        const debitDec = toDecimal(debits._sum.amount);
        const creditDec = toDecimal(credits._sum.amount);
        const effectiveBalance = creditDec.minus(debitDec);

        if (effectiveBalance.lessThan(requestedDec)) {
          throw new BadRequestException(
            `Insufficient balance after considering pending reservations: $${effectiveBalance.toFixed(2)} available`,
          );
        }
      }

      const newPayout = await tx.paymentPayout.create({
        data: {
          payoutNumber,
          agencyId: data.agencyId,
          talentId: data.talentId,
          paymentId: data.paymentId,
          amount: data.amount as any,
          currency: 'USD',
          destinationCurrency: data.destinationCurrency || 'EUR',
          payoutType: 'international',
          status: 'RESERVED',
          destinationAccountGuid: destinationGuid,
          idempotencyKey: data.idempotencyKey,
          metadata: data.metadata || {},
        },
      });

      const debitAccount = await this.ledgerService.getOrCreateAccount({ accountCode: agencyAccountCode });
      const creditAccount = await this.ledgerService.getOrCreateAccount({ accountCode: `CLEARING:OUTBOUND_PAYOUT:USD` });

      await tx.journalEntry.create({
        data: {
          debitAccountId: debitAccount.id,
          creditAccountId: creditAccount.id,
          amount: requestedDec,
          currency: 'USD',
          status: 'pending',
          referenceType: 'FX_TRADE_RESERVATION',
          referenceId: newPayout.id,
          description: `[PENDING] FX trade reservation for International Payout ${payoutNumber}`,
        },
      });

      return newPayout;
    });

    // TODO: Conduit FX / International payout execution
    await this.payoutStateService.transition(payout.id, 'TRANSFER_PENDING');

    await this.syncLegacyWalletBalance(data.agencyId);

    await this.auditLogsService.log({
      userId: data.agencyId,
      action: 'INTERNATIONAL_PAYOUT_INITIATED',
      entityType: 'PaymentPayout',
      entityId: payout.id,
      details: {
        amount: data.amount,
        destinationCurrency: data.destinationCurrency || 'EUR',
        payoutNumber,
      },
    });

    return payout;
  }

  /**
   * ─── 3. Agency Withdrawal to Own Bank Account ─────────────────────
   */
  async requestAgencyWithdrawal(data: {
    agencyId: string;
    amount: number;
    destinationExternalAccountId: string;
    paymentType?: 'ach' | 'wire' | 'rtp';
  }) {
    if (data.amount <= 0) {
      throw new BadRequestException('Withdrawal amount must be greater than zero');
    }

    const user = await this.prisma.user.findUnique({ where: { id: data.agencyId } });
    if (!user) throw new NotFoundException(`Agency ${data.agencyId} not found`);

    const extAccount = await this.prisma.agencyExternalAccount.findFirst({
      where: {
        agencyId: data.agencyId,
        OR: [
          { id: data.destinationExternalAccountId },
          { providerExternalAccountId: data.destinationExternalAccountId },
        ],
      },
    });

    if (!extAccount) {
      throw new NotFoundException('Destination external bank account not found or does not belong to this user');
    }

    const agencyAccountCode = `AGENCY:${data.agencyId}:USD`;
    const ledgerBal = await this.ledgerService.getAccountBalance(agencyAccountCode);
    const availableDec = toDecimal(ledgerBal.balance);
    const requestedDec = toDecimal(data.amount);

    if (availableDec.lessThan(requestedDec)) {
      throw new BadRequestException(`Insufficient balance ($${availableDec.toFixed(2)}) for withdrawal of $${requestedDec.toFixed(2)}`);
    }

    const payoutNumber = `WD-AGY-${Math.floor(100000 + Math.random() * 900000)}`;

    const payout = await this.prisma.$transaction(async (tx) => {
      const account = await tx.ledgerAccount.findUnique({
        where: { accountCode: agencyAccountCode },
      });

      if (account) {
        const debits = await tx.journalEntry.aggregate({
          where: { debitAccountId: account.id, status: { in: ['posted', 'pending'] } },
          _sum: { amount: true },
        });
        const credits = await tx.journalEntry.aggregate({
          where: { creditAccountId: account.id, status: { in: ['posted', 'pending'] } },
          _sum: { amount: true },
        });
        const debitDec = toDecimal(debits._sum.amount);
        const creditDec = toDecimal(credits._sum.amount);
        const effectiveBalance = creditDec.minus(debitDec);

        if (effectiveBalance.lessThan(requestedDec)) {
          throw new BadRequestException(
            `Insufficient balance after considering pending reservations: $${effectiveBalance.toFixed(2)} available`,
          );
        }
      }

      const newPayout = await tx.paymentPayout.create({
        data: {
          payoutNumber,
          agencyId: data.agencyId,
          amount: data.amount as any,
          currency: 'USD',
          payoutType: 'agency_withdrawal',
          status: 'RESERVED',
          destinationAccountGuid: extAccount.providerExternalAccountId,
          metadata: {
            accountName: extAccount.accountName,
            paymentType: data.paymentType || 'ach',
          },
        },
      });

      const debitAccount = await this.ledgerService.getOrCreateAccount({ accountCode: agencyAccountCode });
      const creditAccount = await this.ledgerService.getOrCreateAccount({ accountCode: `CLEARING:OUTBOUND_PAYOUT:USD` });

      await tx.journalEntry.create({
        data: {
          debitAccountId: debitAccount.id,
          creditAccountId: creditAccount.id,
          amount: requestedDec,
          currency: 'USD',
          status: 'pending',
          referenceType: 'AGENCY_SELF_WITHDRAWAL',
          referenceId: newPayout.id,
          description: `[PENDING] Agency self-withdrawal to ${extAccount.bankName} (${extAccount.accountNumberMask})`,
        },
      });

      return newPayout;
    });

    // Create legacy Payout record in pending state for backwards compatibility
    await this.prisma.payout.create({
      data: {
        agencyId: data.agencyId,
        amount: data.amount as any,
        currency: 'USD',
        destinationExternalAccountId: extAccount.id,
        paymentOrderId: payoutNumber,
        status: 'pending',
        metadata: { accountName: extAccount.accountName, paymentType: data.paymentType || 'ach' },
      },
    });

    await this.syncLegacyWalletBalance(data.agencyId);

    await this.auditLogsService.log({
      userId: data.agencyId,
      action: 'AGENCY_WITHDRAWAL_INITIATED',
      entityType: 'PaymentPayout',
      entityId: payout.id,
      details: {
        amount: data.amount,
        bankName: extAccount.bankName,
        accountMask: extAccount.accountNumberMask,
        payoutNumber,
      },
    });

    return payout;
  }

  /**
   * ─── 4. External Accounts & History ────────────────────────────────
   */
  async addAgencyExternalAccount(data: {
    agencyId: string;
    accountName: string;
    bankName: string;
    accountNumber: string;
    routingNumber: string;
    isPrimary?: boolean;
  }) {
    const mask = data.accountNumber.length >= 4 ? data.accountNumber.slice(-4) : 'XXXX';
    const providerExternalAccountId = `ext_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    return this.prisma.agencyExternalAccount.create({
      data: {
        agencyId: data.agencyId,
        accountName: data.accountName,
        bankName: data.bankName,
        accountNumberMask: mask,
        routingNumber: data.routingNumber,
        providerExternalAccountId,
        isPrimary: data.isPrimary ?? false,
      },
    });
  }

  async getAgencyExternalAccounts(agencyId: string) {
    return this.prisma.agencyExternalAccount.findMany({
      where: { agencyId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getPayoutHistory(agencyId: string) {
    return this.prisma.paymentPayout.findMany({
      where: { agencyId },
      include: {
        talent: {
          select: { id: true, fullName: true, email: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async reversePendingReservation(payoutId: string, referenceType: string): Promise<void> {
    const pendingEntry = await this.prisma.journalEntry.findFirst({
      where: { referenceId: payoutId, referenceType, status: 'pending' },
    });

    if (pendingEntry) {
      await this.prisma.journalEntry.update({
        where: { id: pendingEntry.id },
        data: { status: 'void' },
      });
      this.logger.log(`Reversed pending reservation journal entry ${pendingEntry.id} for payout ${payoutId}`);
    }
  }

  async promotePendingToPosted(payoutId: string, referenceType: string, providerReference?: string): Promise<void> {
    const pendingEntry = await this.prisma.journalEntry.findFirst({
      where: { referenceId: payoutId, referenceType, status: 'pending' },
    });

    if (pendingEntry) {
      await this.prisma.journalEntry.update({
        where: { id: pendingEntry.id },
        data: {
          status: 'posted',
          postedAt: new Date(),
          description: providerReference
            ? `${pendingEntry.description} [Confirmed: ${providerReference}]`
            : pendingEntry.description,
        },
      });
      this.logger.log(`Promoted journal entry ${pendingEntry.id} to posted for payout ${payoutId}`);
    }
  }

  private async syncLegacyWalletBalance(agencyId: string) {
    try {
      const balance = await this.ledgerService.getAccountBalance(`AGENCY:${agencyId}:USD`);
      await this.prisma.wallet.upsert({
        where: { userId: agencyId },
        update: { balance: Number(balance.balance) },
        create: {
          userId: agencyId,
          balance: Number(balance.balance),
          currency: 'USD',
          walletId: `wal_${agencyId.slice(-8)}_${Date.now().toString(36)}`,
          accountType: 'agency',
        },
      });
    } catch (err: any) {
      this.logger.warn(`Failed to sync legacy wallet balance for agency ${agencyId}: ${err.message}`);
    }
  }

  async processBatchPayables(data: {
    agencyId: string;
    batchId?: string;
    payables: Array<{
      talentId?: string;
      netPayable: number;
      invoiceId?: string;
      jobId?: string;
      currency?: string;
      idempotencyKey?: string;
    }>;
  }) {
    const results = [];
    for (const item of data.payables) {
      if (!item.talentId) {
        results.push({ talentId: 'unknown', status: 'failed', error: 'Missing talentId' });
        continue;
      }
      try {
        const res = await this.requestDomesticTalentPayout({
          agencyId: data.agencyId,
          talentId: item.talentId,
          amount: item.netPayable,
          paymentId: item.invoiceId,
          idempotencyKey: item.idempotencyKey,
        });
        results.push({ talentId: item.talentId, status: 'success', payout: res });
      } catch (err: any) {
        results.push({ talentId: item.talentId, status: 'failed', error: err.message });
      }
    }
    return results;
  }
}

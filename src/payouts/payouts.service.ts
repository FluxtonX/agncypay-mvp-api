import { Injectable, NotFoundException, BadRequestException, BadGatewayException, Logger, Inject } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../modules/audit-logs/audit-logs.service';
import { LedgerService } from '../modules/ledger/ledger.service';
import { CybridCustomerService } from '../modules/cybrid/cybrid-customer.service';
import { CybridAccountService } from '../modules/cybrid/cybrid-account.service';
import { ExternalBankAccountService } from '../modules/cybrid/external-bank-account.service';
import { PayoutStateService } from '../modules/payouts/payout-state.service';
import { CybridConfigService } from '../infrastructure/providers/cybrid/cybrid-config.service';
import type { IFinancialProvider } from '../core/interfaces/financial-provider.interface';
import { toDecimal } from '../common/utils/decimal.util';
import { PayoutStatus } from '@prisma/client';

@Injectable()
export class PayoutsService {
  private readonly logger = new Logger(PayoutsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
    private readonly ledgerService: LedgerService,
    private readonly customerService: CybridCustomerService,
    private readonly accountService: CybridAccountService,
    private readonly externalBankAccountService: ExternalBankAccountService,
    private readonly payoutStateService: PayoutStateService,
    private readonly config: CybridConfigService,
    @Inject('IFinancialProvider') private readonly cybridProvider: IFinancialProvider,
  ) {}

  /**
   * ─── 1. Domestic Talent Payout ───────────────────────────────────
   * Agency USD Fiat Account → Cybrid Quote → Cybrid Transfer → Talent Counterparty Bank
   *
   * Financial correctness:
   * - Balance reservation is ATOMIC (pending journal entry inside DB transaction)
   * - Ledger entry starts as 'pending', promoted to 'posted' only on webhook confirmation
   * - Payout stays in TRANSFER_PENDING until Cybrid webhook confirms completion/failure
   */
  async requestDomesticTalentPayout(data: {
    agencyId: string;
    talentId: string;
    amount: number;
    currency?: string;
    paymentId?: string; // Optional link to parent Brand Payment
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

    // 2. Validate Agency balance using Decimal comparison (not float)
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
    const talent = await this.prisma.talent.findFirst({
      where: { id: data.talentId, agencyId: data.agencyId, deletedAt: null },
      include: {
        counterparties: {
          include: { externalBankAccounts: true },
        },
      },
    });

    if (!talent) {
      throw new NotFoundException(`Talent ${data.talentId} not found for this Agency`);
    }

    const counterparty = talent.counterparties[0];
    if (!counterparty) {
      throw new BadRequestException(`Talent has no Cybrid Counterparty configured`);
    }

    const externalBank = counterparty.externalBankAccounts[0];
    if (!externalBank) {
      throw new BadRequestException(`Talent has no linked External Bank Account`);
    }

    // 4. Ensure Agency USD Fiat Account
    const agencyCustomer = await this.customerService.createOrGetCustomer(data.agencyId);
    const agencyUsdAccount = await this.accountService.ensureUsdFiatAccount(data.agencyId);

    const payoutNumber = `PO-DOM-${Math.floor(100000 + Math.random() * 900000)}`;

    if (!this.config.isConfigured) {
      throw new BadGatewayException('Cybrid configuration credentials missing in environment.');
    }

    // 5. ATOMIC: Create payout record + reserve funds via pending journal entry in a transaction
    const payout = await this.prisma.$transaction(async (tx) => {
      // Re-check balance inside the transaction for concurrency safety
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
        // Liability account: balance = credits - debits
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
          destinationAccountGuid: externalBank.cybridExternalBankGuid,
          idempotencyKey: data.idempotencyKey,
          metadata: data.metadata || {},
        },
      });

      // Post PENDING journal entry (reservation — not finalized until webhook)
      const debitAccount = await this.ledgerService.getOrCreateAccount({ accountCode: agencyAccountCode });
      const creditAccount = await this.ledgerService.getOrCreateAccount({ accountCode: `CLEARING:CYBRID_OUTBOUND:USD` });

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

    // 6. Execute Cybrid quote + transfer (outside the DB transaction)
    let quoteGuid: string;
    let transferGuid: string;

    try {
      await this.payoutStateService.transition(payout.id, 'VALIDATING');
      await this.payoutStateService.transition(payout.id, 'QUOTE_PENDING');

      const quote = await this.cybridProvider.createQuote({
        customerGuid: agencyCustomer.cybridCustomerGuid,
        productType: 'funding',
        asset: 'USD',
        side: 'withdrawal',
        deliverAmount: Math.round(data.amount * 100), // Cybrid integer cents
      });
      quoteGuid = quote.guid;

      await this.payoutStateService.transition(payout.id, 'TRANSFER_PENDING');

      const transfer = await this.cybridProvider.createTransfer({
        quoteGuid: quote.guid,
        transferType: 'funding',
        sourceAccountGuid: agencyUsdAccount.cybridAccountGuid,
        externalBankAccountGuid: externalBank.cybridExternalBankGuid,
      });
      transferGuid = transfer.guid;
    } catch (err) {
      this.logger.error(`Domestic payout execution failed: ${err.message}`);

      // Reverse the pending reservation
      await this.reversePendingReservation(payout.id, 'DOMESTIC_TALENT_PAYOUT');

      await this.payoutStateService.transition(payout.id, 'FAILED', {
        reason: err.message,
        stage: 'TRANSFER_EXECUTION',
      });
      throw new BadGatewayException(`Payout transfer failed: ${err.message}`);
    }

    // 7. Save Cybrid references
    const updatedPayout = await this.prisma.paymentPayout.update({
      where: { id: payout.id },
      data: {
        cybridQuoteGuid: quoteGuid,
        cybridTransferGuid: transferGuid,
      },
    });

    // Record Provider Operation
    await this.prisma.providerOperation.create({
      data: {
        provider: 'cybrid',
        operationType: 'transfer',
        operationGuid: transferGuid,
        payoutId: payout.id,
        status: 'pending',
      },
    });

    // NOTE: Ledger entry remains in 'pending' status.
    // It will be promoted to 'posted' when the Cybrid webhook confirms transfer.completed.
    // If webhook reports transfer.failed, the pending entry will be reversed.

    await this.syncLegacyWalletBalance(data.agencyId);

    await this.auditLogsService.log({
      userId: data.agencyId,
      action: 'DOMESTIC_PAYOUT_INITIATED',
      entityType: 'PaymentPayout',
      entityId: payout.id,
      details: {
        amount: data.amount,
        talentName: talent.fullName,
        transferGuid,
        quoteGuid,
      },
    });

    return updatedPayout;
  }

  /**
   * ─── 2. International Talent Payout ──────────────────────────────
   * Agency USD → Quote (USD → USDC) → Trade → Agency USDC Account → Remittance Plan → Execution → Talent Bank
   *
   * Financial correctness:
   * - Balance reservation is ATOMIC (pending journal entry inside DB transaction)
   * - Trade completion is NOT assumed synchronously — waits for webhook
   * - FX ledger entry deferred until trade.completed webhook
   * - Remittance completion tracked through execution webhooks
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

    // 1. Check idempotency
    if (data.idempotencyKey) {
      const existing = await this.prisma.paymentPayout.findUnique({
        where: { idempotencyKey: data.idempotencyKey },
      });
      if (existing) return existing;
    }

    // 2. Validate Agency balance using Decimal comparison
    const agencyAccountCode = `AGENCY:${data.agencyId}:USD`;
    const ledgerBalance = await this.ledgerService.getAccountBalance(agencyAccountCode);
    const availableDec = toDecimal(ledgerBalance.balance);
    const requestedDec = toDecimal(data.amount);

    if (availableDec.lessThan(requestedDec)) {
      throw new BadRequestException(
        `Insufficient available balance ($${availableDec.toFixed(2)}) for international payout of $${requestedDec.toFixed(2)}`,
      );
    }

    // 3. Resolve Talent & Counterparty
    const talent = await this.prisma.talent.findFirst({
      where: { id: data.talentId, agencyId: data.agencyId, deletedAt: null },
      include: {
        counterparties: {
          include: { externalBankAccounts: true },
        },
      },
    });

    if (!talent) throw new NotFoundException(`Talent ${data.talentId} not found`);

    const counterparty = talent.counterparties[0];
    const externalBank = counterparty?.externalBankAccounts[0];

    // 4. Ensure Agency USDC Trading Account
    const agencyCustomer = await this.customerService.createOrGetCustomer(data.agencyId);
    await this.accountService.ensureTradingAccount(data.agencyId);

    const payoutNumber = `PO-INTL-${Math.floor(100000 + Math.random() * 900000)}`;

    if (!this.config.isConfigured) {
      throw new BadGatewayException('Cybrid configuration credentials missing in environment.');
    }

    // 5. ATOMIC: Create payout record + reserve funds
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
          destinationAccountGuid: externalBank?.cybridExternalBankGuid,
          idempotencyKey: data.idempotencyKey,
          metadata: data.metadata || {},
        },
      });

      // Pending reservation journal entry (USD side)
      const debitAccount = await this.ledgerService.getOrCreateAccount({ accountCode: agencyAccountCode });
      const creditAccount = await this.ledgerService.getOrCreateAccount({ accountCode: `AGENCY:${data.agencyId}:USDC_TRADING` });

      await tx.journalEntry.create({
        data: {
          debitAccountId: debitAccount.id,
          creditAccountId: creditAccount.id,
          amount: requestedDec,
          currency: 'USD',
          status: 'pending',
          referenceType: 'FX_TRADE_USD_TO_USDC',
          referenceId: newPayout.id,
          description: `[PENDING] FX trade reservation for International Payout ${payoutNumber}`,
        },
      });

      return newPayout;
    });

    // 6. Execute Cybrid quote + trade (outside DB transaction)
    let quoteGuid: string;
    let tradeGuid: string;

    try {
      await this.payoutStateService.transition(payout.id, 'VALIDATING');
      await this.payoutStateService.transition(payout.id, 'QUOTE_PENDING');

      const quote = await this.cybridProvider.createQuote({
        customerGuid: agencyCustomer.cybridCustomerGuid,
        productType: 'trading',
        symbol: 'USDC-USD',
        side: 'buy',
        deliverAmount: Math.round(data.amount * 100),
      });
      quoteGuid = quote.guid;

      // Execute Trade — status will be 'storing' initially, NOT completed
      await this.payoutStateService.transition(payout.id, 'TRADE_PENDING');

      const trade = await this.cybridProvider.createTrade({
        quoteGuid: quote.guid,
      });
      tradeGuid = trade.guid;

      // *** DO NOT transition to TRADE_COMPLETED here ***
      // Trade completion is confirmed ONLY by the trade.completed webhook.
      // The payout stays in TRADE_PENDING until that webhook arrives.

    } catch (err) {
      this.logger.error(`International trade execution failed: ${err.message}`);

      // Reverse pending reservation
      await this.reversePendingReservation(payout.id, 'FX_TRADE_USD_TO_USDC');

      await this.payoutStateService.transition(payout.id, 'FAILED', {
        reason: err.message,
        stage: 'FX_TRADE',
      });
      throw new BadGatewayException(`International trade step failed: ${err.message}`);
    }

    const updatedPayout = await this.prisma.paymentPayout.update({
      where: { id: payout.id },
      data: {
        cybridQuoteGuid: quoteGuid,
        cybridTradeGuid: tradeGuid,
      },
    });

    // Record Provider Operations
    await this.prisma.providerOperation.create({
      data: {
        provider: 'cybrid',
        operationType: 'trade',
        operationGuid: tradeGuid,
        payoutId: payout.id,
        status: 'pending',
      },
    });

    // NOTE: Ledger entry remains 'pending' until trade.completed webhook.
    // On trade.completed, the webhook handler will:
    //   1. Promote the pending entry to 'posted'
    //   2. Transition payout to TRADE_COMPLETED
    //   3. Initiate remittance plan if applicable

    await this.syncLegacyWalletBalance(data.agencyId);

    await this.auditLogsService.log({
      userId: data.agencyId,
      action: 'INTERNATIONAL_PAYOUT_INITIATED',
      entityType: 'PaymentPayout',
      entityId: payout.id,
      details: {
        amount: data.amount,
        talentName: talent.fullName,
        destinationCurrency: payout.destinationCurrency,
        quoteGuid,
        tradeGuid,
      },
    });

    return updatedPayout;
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

    const cybridEba = await this.prisma.cybridExternalBankAccount?.findFirst({
      where: {
        agencyUserId: data.agencyId,
        cybridExternalBankGuid: extAccount.providerExternalAccountId,
      },
    });

    if (cybridEba && (cybridEba.status === 'failed' || cybridEba.status === 'deleted')) {
      throw new BadRequestException(`Selected bank account is not eligible for payout (status: ${cybridEba.status})`);
    }

    const agencyAccountCode = `AGENCY:${data.agencyId}:USD`;
    const ledgerBal = await this.ledgerService.getAccountBalance(agencyAccountCode);
    const availableDec = toDecimal(ledgerBal.balance);
    const requestedDec = toDecimal(data.amount);

    if (availableDec.lessThan(requestedDec)) {
      throw new BadRequestException(`Insufficient balance ($${availableDec.toFixed(2)}) for withdrawal of $${requestedDec.toFixed(2)}`);
    }

    const payoutNumber = `WD-AGY-${Math.floor(100000 + Math.random() * 900000)}`;

    // ATOMIC reservation
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

      // Pending reservation journal
      const debitAccount = await this.ledgerService.getOrCreateAccount({ accountCode: agencyAccountCode });
      const creditAccount = await this.ledgerService.getOrCreateAccount({ accountCode: `CLEARING:CYBRID_WITHDRAWAL:USD` });

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
      details: { amount: data.amount, destination: extAccount.accountName },
    });

    return payout;
  }

  // ─── Backwards Compatibility Helpers for Existing UI ───────────

  async addAgencyExternalAccount(data: {
    agencyId: string;
    accountName: string;
    bankName: string;
    accountNumber: string;
    routingNumber: string;
    isPrimary?: boolean;
  }) {
    // Delegate to ExternalBankAccountService for real Cybrid creation
    return this.externalBankAccountService.linkAgencyBankAccount({
      agencyId: data.agencyId,
      accountName: data.accountName,
      bankName: data.bankName,
      accountNumber: data.accountNumber,
      routingNumber: data.routingNumber,
      isPrimary: data.isPrimary,
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
      include: { talent: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Reverse a pending journal entry reservation (e.g., when Cybrid API call fails).
   * This does NOT create a reversal entry — it simply marks the pending entry as 'reversed'.
   */
  async reversePendingReservation(payoutId: string, referenceType: string): Promise<void> {
    try {
      await this.prisma.journalEntry.updateMany({
        where: {
          referenceId: payoutId,
          referenceType,
          status: 'pending',
        },
        data: { status: 'reversed' },
      });
      this.logger.log(`Reversed pending reservation for payout ${payoutId} (${referenceType})`);
    } catch (err) {
      this.logger.error(`Failed to reverse pending reservation for payout ${payoutId}: ${err.message}`);
    }
  }

  /**
   * Promote a pending journal entry to 'posted' (called by webhook handler on successful confirmation).
   */
  async promotePendingToPosted(payoutId: string, referenceType: string, providerReference?: string): Promise<void> {
    const result = await this.prisma.journalEntry.updateMany({
      where: {
        referenceId: payoutId,
        referenceType,
        status: 'pending',
      },
      data: {
        status: 'posted',
        providerReference: providerReference || undefined,
      },
    });
    this.logger.log(`Promoted ${result.count} pending entries to posted for payout ${payoutId} (${referenceType})`);
  }

  private async syncLegacyWalletBalance(agencyId: string) {
    try {
      const ledgerBal = await this.ledgerService.getAccountBalance(`AGENCY:${agencyId}:USD`);
      const existing = await this.prisma.wallet.findFirst({ where: { userId: agencyId } });
      if (existing) {
        await this.prisma.wallet.update({
          where: { id: existing.id },
          data: { balance: ledgerBal.balance as any },
        });
      } else {
        await this.prisma.wallet.create({
          data: {
            walletId: `WAL-AGY-${Math.floor(100000 + Math.random() * 900000)}`,
            userId: agencyId,
            accountType: 'agency',
            balance: ledgerBal.balance as any,
            currency: 'USD',
            status: 'active',
          },
        });
      }
    } catch (err) {
      this.logger.warn(`Could not sync wallet balance for agency ${agencyId}: ${err.message}`);
    }
  }

  /**
   * Process a recurring batch of approved payable instructions from Agency CRM / CSV export.
   * Treats netPayable as the authoritative execution value without recalculating commissions.
   */
  async processBatchPayables(data: {
    agencyId: string;
    batchId?: string;
    payables: Array<{
      externalTalentId?: string;
      talentId?: string;
      talentName?: string;
      email?: string;
      phone?: string;
      invoiceId?: string;
      jobId?: string;
      grossAmount?: number;
      commission?: number;
      expenses?: number;
      netPayable: number;
      currency?: string;
      metadata?: Record<string, any>;
    }>;
  }) {
    if (!data.payables || data.payables.length === 0) {
      throw new BadRequestException('Payables batch must contain at least one instruction');
    }

    const batchId = data.batchId || `batch_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const results = {
      batchId,
      totalInstructions: data.payables.length,
      totalNetPayable: 0,
      successfulCount: 0,
      failedCount: 0,
      payouts: [] as any[],
      errors: [] as Array<{ index: number; externalTalentId?: string; error: string }>,
    };

    let totalBatchAmount = 0;
    for (const item of data.payables) {
      if (item.netPayable <= 0) {
        throw new BadRequestException(
          `Net payable amount for talent ${item.talentName || item.externalTalentId || 'item'} must be > 0`,
        );
      }
      totalBatchAmount += item.netPayable;
    }
    results.totalNetPayable = totalBatchAmount;

    const agencyAccountCode = `AGENCY:${data.agencyId}:USD`;
    const ledgerBal = await this.ledgerService.getAccountBalance(agencyAccountCode);
    const availableDec = toDecimal(ledgerBal.balance);
    const requiredDec = toDecimal(totalBatchAmount);

    if (availableDec.lessThan(requiredDec)) {
      throw new BadRequestException(
        `Insufficient available Agency balance ($${availableDec.toFixed(2)}) to execute batch total ($${requiredDec.toFixed(2)})`,
      );
    }

    for (let i = 0; i < data.payables.length; i++) {
      const item = data.payables[i];

      try {
        let talent = null;
        if (item.talentId) {
          talent = await this.prisma.talent.findFirst({
            where: { id: item.talentId, agencyId: data.agencyId, deletedAt: null },
          });
        }

        if (!talent && item.email) {
          talent = await this.prisma.talent.findFirst({
            where: { agencyId: data.agencyId, email: item.email, deletedAt: null },
          });
        }

        if (!talent && item.externalTalentId) {
          const allAgencyTalents = await this.prisma.talent.findMany({
            where: { agencyId: data.agencyId, deletedAt: null },
          });
          talent = allAgencyTalents.find(
            (t) => (t.metadata as Record<string, any>)?.externalTalentId === item.externalTalentId,
          ) || null;
        }

        if (!talent) {
          throw new NotFoundException(
            `Talent not found by external ID ${item.externalTalentId || ''} or email ${item.email || ''}`,
          );
        }

        const richMetadata = {
          ...(item.metadata || {}),
          batchId,
          externalTalentId: item.externalTalentId,
          externalJobId: item.jobId,
          externalInvoiceId: item.invoiceId,
          grossAmount: item.grossAmount,
          agencyCommission: item.commission,
          expensesDeductions: item.expenses,
          netPayable: item.netPayable,
          sourceSystem: 'CRM_BATCH_IMPORT',
        };

        const payoutResult = await this.requestDomesticTalentPayout({
          agencyId: data.agencyId,
          talentId: talent.id,
          amount: item.netPayable,
          currency: item.currency || 'USD',
          paymentId: item.invoiceId,
          metadata: richMetadata,
        });

        results.successfulCount++;
        results.payouts.push(payoutResult);
      } catch (err: any) {
        results.failedCount++;
        results.errors.push({
          index: i,
          externalTalentId: item.externalTalentId,
          error: err.message,
        });
      }
    }

    await this.auditLogsService.log({
      userId: data.agencyId,
      action: 'BATCH_PAYABLES_EXECUTED',
      entityType: 'PaymentPayoutBatch',
      details: {
        batchId,
        totalInstructions: results.totalInstructions,
        successfulCount: results.successfulCount,
        failedCount: results.failedCount,
        totalNetPayable: results.totalNetPayable,
      },
    });

    return results;
  }
}

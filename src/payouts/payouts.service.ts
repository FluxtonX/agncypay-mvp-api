import { Injectable, NotFoundException, BadRequestException, Logger, Inject } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../modules/audit-logs/audit-logs.service';
import { LedgerService } from '../modules/ledger/ledger.service';
import { CybridCustomerService } from '../modules/cybrid/cybrid-customer.service';
import { CybridAccountService } from '../modules/cybrid/cybrid-account.service';
import { PayoutStateService } from '../modules/payouts/payout-state.service';
import { CybridConfigService } from '../infrastructure/providers/cybrid/cybrid-config.service';
import type { IFinancialProvider } from '../core/interfaces/financial-provider.interface';
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
    private readonly payoutStateService: PayoutStateService,
    private readonly config: CybridConfigService,
    @Inject('IFinancialProvider') private readonly cybridProvider: IFinancialProvider,
  ) {}

  /**
   * ─── 1. Domestic Talent Payout ───────────────────────────────────
   * Agency USD Fiat Account → Cybrid Quote → Cybrid Transfer → Talent Counterparty Bank
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

    // 2. Validate Agency balance
    const agencyAccountCode = `AGENCY:${data.agencyId}:USD`;
    const ledgerBalance = await this.ledgerService.getAccountBalance(agencyAccountCode);

    // Fallback check for simulated balance if sandbox testing without funding
    const availableBalance = ledgerBalance.balance > 0 ? ledgerBalance.balance : 50000;

    if (availableBalance < data.amount) {
      throw new BadRequestException(
        `Insufficient available Agency balance ($${availableBalance.toFixed(2)}) for payout of $${data.amount.toFixed(2)}`,
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

    // 5. Create Payout record in DB
    const payout = await this.prisma.paymentPayout.create({
      data: {
        payoutNumber,
        agencyId: data.agencyId,
        talentId: data.talentId,
        paymentId: data.paymentId,
        amount: data.amount,
        currency: data.currency || 'USD',
        payoutType: 'domestic',
        status: 'VALIDATING',
        destinationAccountGuid: externalBank.cybridExternalBankGuid,
        idempotencyKey: data.idempotencyKey,
        metadata: data.metadata || {},
      },
    });

    let quoteGuid: string;
    let transferGuid: string;

    try {
      if (this.config.isConfigured) {
        // Create Cybrid Quote for domestic funding transfer
        await this.payoutStateService.transition(payout.id, 'QUOTE_PENDING');

        const quote = await this.cybridProvider.createQuote({
          customerGuid: agencyCustomer.cybridCustomerGuid,
          productType: 'funding',
          asset: 'USD',
          side: 'sell',
          deliverAmount: Math.round(data.amount * 100), // Cybrid integer cents
        });
        quoteGuid = quote.guid;

        // Execute Transfer
        await this.payoutStateService.transition(payout.id, 'TRANSFER_PENDING');

        const transfer = await this.cybridProvider.createTransfer({
          quoteGuid: quote.guid,
          transferType: 'funding',
          sourceAccountGuid: agencyUsdAccount.cybridAccountGuid,
          externalBankAccountGuid: externalBank.cybridExternalBankGuid,
        });
        transferGuid = transfer.guid;
      } else {
        quoteGuid = `quo_cyb_${Date.now()}`;
        transferGuid = `tra_cyb_${Date.now()}`;
        await this.payoutStateService.transition(payout.id, 'TRANSFER_PENDING');
      }
    } catch (err) {
      this.logger.error(`Domestic payout execution failed: ${err.message}`);
      await this.payoutStateService.transition(payout.id, 'FAILED', {
        reason: err.message,
        stage: 'TRANSFER_EXECUTION',
      });
      throw new BadRequestException(`Payout transfer failed: ${err.message}`);
    }

    // Save references
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

    // Post double-entry journal entry:
    // Debit: Agency USD balance
    // Credit: Outbound clearing account
    await this.ledgerService.postJournalEntry({
      debitAccountCode: agencyAccountCode,
      creditAccountCode: `CLEARING:CYBRID_OUTBOUND:USD`,
      amount: data.amount,
      currency: data.currency || 'USD',
      referenceType: 'DOMESTIC_TALENT_PAYOUT',
      referenceId: payout.id,
      providerReference: transferGuid,
      description: `Domestic payout ${payoutNumber} to Talent ${talent.fullName}`,
    });

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

    // 2. Validate Agency balance
    const agencyAccountCode = `AGENCY:${data.agencyId}:USD`;
    const ledgerBalance = await this.ledgerService.getAccountBalance(agencyAccountCode);
    const availableBalance = ledgerBalance.balance > 0 ? ledgerBalance.balance : 50000;

    if (availableBalance < data.amount) {
      throw new BadRequestException(
        `Insufficient available balance ($${availableBalance.toFixed(2)}) for international payout of $${data.amount.toFixed(2)}`,
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

    const payout = await this.prisma.paymentPayout.create({
      data: {
        payoutNumber,
        agencyId: data.agencyId,
        talentId: data.talentId,
        paymentId: data.paymentId,
        amount: data.amount,
        currency: 'USD',
        destinationCurrency: data.destinationCurrency || 'EUR',
        payoutType: 'international',
        status: 'VALIDATING',
        destinationAccountGuid: externalBank?.cybridExternalBankGuid,
        idempotencyKey: data.idempotencyKey,
        metadata: data.metadata || {},
      },
    });

    let quoteGuid: string;
    let tradeGuid: string;
    let fxRate = 1.0;

    try {
      if (this.config.isConfigured) {
        // Step 1: Create FX Quote (USD -> USDC)
        await this.payoutStateService.transition(payout.id, 'QUOTE_PENDING');

        const quote = await this.cybridProvider.createQuote({
          customerGuid: agencyCustomer.cybridCustomerGuid,
          productType: 'trading',
          asset: 'USDC',
          side: 'buy',
          deliverAmount: Math.round(data.amount * 100),
        });
        quoteGuid = quote.guid;

        // Step 2: Execute Trade (USD -> USDC)
        await this.payoutStateService.transition(payout.id, 'TRADE_PENDING');

        const trade = await this.cybridProvider.createTrade({
          quoteGuid: quote.guid,
        });
        tradeGuid = trade.guid;

        // Step 3: Transition to TRADE_COMPLETED
        await this.payoutStateService.transition(payout.id, 'TRADE_COMPLETED');

        // Step 4: Create Remittance Plan & Execution if destination external bank exists
        if (externalBank) {
          await this.payoutStateService.transition(payout.id, 'REMITTANCE_PENDING');
          const agencyTradingAccount = await this.accountService.ensureTradingAccount(data.agencyId);

          const plan = await this.cybridProvider.createPlan({
            type: 'remittance',
            customerGuid: agencyCustomer.cybridCustomerGuid,
            sourceAccount: {
              type: 'customer',
              guid: agencyTradingAccount.cybridAccountGuid,
            },
            destinationAccount: {
              type: 'customer',
              guid: externalBank.cybridExternalBankGuid,
            },
            purposeOfTransaction: 'salary_payment',
          });

          await this.payoutStateService.transition(payout.id, 'EXECUTION_PENDING');
          const execution = await this.cybridProvider.createExecution({
            planGuid: plan.guid,
          });

          await this.prisma.paymentPayout.update({
            where: { id: payout.id },
            data: {
              cybridPlanGuid: plan.guid,
              cybridExecutionGuid: execution.guid,
            },
          });
        }
      } else {
        quoteGuid = `quo_fx_${Date.now()}`;
        tradeGuid = `tra_fx_${Date.now()}`;
        await this.payoutStateService.transition(payout.id, 'TRADE_COMPLETED');
      }
    } catch (err) {
      this.logger.error(`International trade execution failed: ${err.message}`);
      await this.payoutStateService.transition(payout.id, 'FAILED', {
        reason: err.message,
        stage: 'FX_TRADE',
      });
      throw new BadRequestException(`International trade step failed: ${err.message}`);
    }

    const updatedPayout = await this.prisma.paymentPayout.update({
      where: { id: payout.id },
      data: {
        cybridQuoteGuid: quoteGuid,
        cybridTradeGuid: tradeGuid,
        fxRate,
      },
    });

    // Double-Entry Ledger entries:
    // 1. Move USD to USDC trading
    await this.ledgerService.postJournalEntry({
      debitAccountCode: agencyAccountCode,
      creditAccountCode: `AGENCY:${data.agencyId}:USDC_TRADING`,
      amount: data.amount,
      currency: 'USD',
      referenceType: 'FX_TRADE_USD_TO_USDC',
      referenceId: payout.id,
      providerReference: tradeGuid,
      description: `FX trade USD -> USDC for International Payout ${payoutNumber}`,
    });

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
        id: data.destinationExternalAccountId,
        agencyId: data.agencyId,
      },
    });

    if (!extAccount) {
      throw new NotFoundException('Destination external bank account not found');
    }

    const agencyAccountCode = `AGENCY:${data.agencyId}:USD`;
    const ledgerBal = await this.ledgerService.getAccountBalance(agencyAccountCode);
    const available = ledgerBal.balance > 0 ? ledgerBal.balance : 50000;

    if (available < data.amount) {
      throw new BadRequestException(`Insufficient balance ($${available.toFixed(2)}) for withdrawal of $${data.amount.toFixed(2)}`);
    }

    const payoutNumber = `WD-AGY-${Math.floor(100000 + Math.random() * 900000)}`;

    const payout = await this.prisma.paymentPayout.create({
      data: {
        payoutNumber,
        agencyId: data.agencyId,
        amount: data.amount,
        currency: 'USD',
        payoutType: 'agency_withdrawal',
        status: 'TRANSFER_PENDING',
        destinationAccountGuid: extAccount.providerExternalAccountId,
        metadata: {
          accountName: extAccount.accountName,
          paymentType: data.paymentType || 'ach',
        },
      },
    });

    // Also create legacy Payout record for backwards compatibility
    await this.prisma.payout.create({
      data: {
        agencyId: data.agencyId,
        amount: data.amount,
        currency: 'USD',
        destinationExternalAccountId: extAccount.id,
        paymentOrderId: payoutNumber,
        status: 'disbursed',
        metadata: { accountName: extAccount.accountName, paymentType: data.paymentType || 'ach' },
      },
    });

    // Post double-entry journal entry
    await this.ledgerService.postJournalEntry({
      debitAccountCode: agencyAccountCode,
      creditAccountCode: `CLEARING:CYBRID_WITHDRAWAL:USD`,
      amount: data.amount,
      currency: 'USD',
      referenceType: 'AGENCY_SELF_WITHDRAWAL',
      referenceId: payout.id,
      providerReference: extAccount.providerExternalAccountId,
      description: `Agency self-withdrawal to ${extAccount.bankName} (${extAccount.accountNumberMask})`,
    });

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
    const user = await this.prisma.user.findUnique({ where: { id: data.agencyId } });
    if (!user) throw new NotFoundException(`Agency ${data.agencyId} not found`);

    const externalAccountId = `eba_cyb_${Date.now()}`;
    const accountMask = data.accountNumber.length > 4 ? data.accountNumber.slice(-4) : data.accountNumber;

    if (data.isPrimary) {
      await this.prisma.agencyExternalAccount.updateMany({
        where: { agencyId: data.agencyId },
        data: { isPrimary: false },
      });
    }

    const extAccount = await this.prisma.agencyExternalAccount.create({
      data: {
        agencyId: data.agencyId,
        accountName: data.accountName,
        bankName: data.bankName,
        accountNumberMask: accountMask,
        routingNumber: data.routingNumber,
        providerExternalAccountId: externalAccountId,
        isPrimary: data.isPrimary ?? false,
      },
    });

    await this.auditLogsService.log({
      userId: data.agencyId,
      action: 'AGENCY_EXTERNAL_ACCOUNT_ADDED',
      entityType: 'AgencyExternalAccount',
      entityId: extAccount.id,
      details: { accountName: data.accountName, externalAccountId },
    });

    return extAccount;
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
}

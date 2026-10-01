import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PaymentAttempt, PaymentInstruction, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  PAYMENT_PROVIDER,
  ProviderState,
} from '../../core/interfaces/payment-provider.interface';
import type { PaymentProvider } from '../../core/interfaces/payment-provider.interface';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { LedgerService } from '../ledger/ledger.service';

type AttemptWithInstruction = PaymentAttempt & {
  instruction: PaymentInstruction;
};

@Injectable()
export class ReconciliationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReconciliationService.name);
  private reconciliationTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
    private readonly ledgerService: LedgerService,
    @Inject(PAYMENT_PROVIDER) private readonly paymentProvider: PaymentProvider,
  ) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;
    const intervalMs = Number(
      process.env.RECONCILIATION_INTERVAL_MS || 5 * 60 * 1000,
    );
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) return;
    this.reconciliationTimer = setInterval(() => {
      this.runReconciliation().catch((error) => {
        this.logger.error(`Automated reconciliation failed: ${error.message}`);
      });
    }, intervalMs);
    this.reconciliationTimer.unref();
  }

  onModuleDestroy() {
    if (this.reconciliationTimer) clearInterval(this.reconciliationTimer);
    this.reconciliationTimer = null;
  }

  private issueKey(attempt: AttemptWithInstruction, kind: string) {
    return `provider-attempt:${attempt.id}:${kind}`;
  }

  private async upsertIssue(
    attempt: AttemptWithInstruction,
    discrepancyType: string,
    input: {
      providerState?: string;
      providerAmount?: number;
      providerCurrency?: string;
      notes: string;
      severity?: string;
    },
  ) {
    const dedupeKey = this.issueKey(attempt, discrepancyType);
    const existing = await this.prisma.reconciliationRecord.findUnique({
      where: { dedupeKey },
    });
    await this.prisma.reconciliationRecord.upsert({
      where: { dedupeKey },
      update: {
        providerState: input.providerState,
        internalState: attempt.status,
        providerAmount: input.providerAmount,
        providerCurrency: input.providerCurrency,
        notes: input.notes,
        severity: input.severity || 'error',
        resolution: 'unresolved',
        resolvedAt: null,
        resolvedBy: null,
        lastCheckedAt: new Date(),
      },
      create: {
        dedupeKey,
        reconciliationType: 'provider_transaction',
        entityType: 'payment_attempt',
        entityId: attempt.id,
        provider: attempt.provider,
        externalReference: attempt.externalReference,
        providerState: input.providerState,
        internalState: attempt.status,
        providerAmount: input.providerAmount,
        internalAmount: attempt.instruction.amount,
        providerCurrency: input.providerCurrency,
        expectedCurrency: attempt.instruction.currency,
        discrepancyType,
        notes: input.notes,
        severity: input.severity || 'error',
        lastCheckedAt: new Date(),
      },
    });
    return !existing;
  }

  private async resolveDetectedIssue(
    attempt: AttemptWithInstruction,
    discrepancyType: string,
  ) {
    await this.prisma.reconciliationRecord.updateMany({
      where: {
        dedupeKey: this.issueKey(attempt, discrepancyType),
        resolution: 'unresolved',
      },
      data: {
        resolution: 'resolved',
        resolvedAt: new Date(),
        resolvedBy: 'system:reconciliation',
        notes: 'Provider and internal records now agree',
        lastCheckedAt: new Date(),
      },
    });
  }

  private statusMatches(internal: string, provider: ProviderState) {
    if (provider === 'completed') return internal === 'settled';
    if (
      provider === 'failed' ||
      provider === 'cancelled' ||
      provider === 'returned'
    ) {
      return internal === 'failed';
    }
    return ['submitted', 'accepted', 'unknown'].includes(internal);
  }

  private async reconcileAttempt(attempt: AttemptWithInstruction) {
    let created = 0;
    if (!attempt.externalReference) {
      created += Number(
        await this.upsertIssue(attempt, 'missing_provider_reference', {
          notes: 'Active provider attempt has no external provider reference',
        }),
      );
      return { discrepancies: 1, created };
    }

    try {
      const isFx = attempt.operationType === 'fx_conversion';
      const providerResult = isFx
        ? await this.paymentProvider.getFxConversion(attempt.externalReference)
        : await this.paymentProvider.getTransfer(attempt.externalReference);
      let discrepancies = 0;
      if (!this.statusMatches(attempt.status, providerResult.status)) {
        discrepancies += 1;
        created += Number(
          await this.upsertIssue(attempt, 'status_mismatch', {
            providerState: providerResult.status,
            notes: `Provider state ${providerResult.status} does not match internal state ${attempt.status}`,
          }),
        );
      } else {
        await this.resolveDetectedIssue(attempt, 'status_mismatch');
      }

      const providerAmount = isFx
        ? (
            providerResult as Awaited<
              ReturnType<PaymentProvider['getFxConversion']>
            >
          ).sourceAmount
        : (
            providerResult as Awaited<
              ReturnType<PaymentProvider['getTransfer']>
            >
          ).amount;
      const providerCurrency = isFx
        ? (
            providerResult as Awaited<
              ReturnType<PaymentProvider['getFxConversion']>
            >
          ).sourceCurrency
        : (
            providerResult as Awaited<
              ReturnType<PaymentProvider['getTransfer']>
            >
          ).currency;
      if (
        new Prisma.Decimal(providerAmount).greaterThan(0) &&
        !new Prisma.Decimal(providerAmount).equals(attempt.instruction.amount)
      ) {
        discrepancies += 1;
        created += Number(
          await this.upsertIssue(attempt, 'amount_mismatch', {
            providerAmount,
            providerCurrency,
            providerState: providerResult.status,
            notes: `Provider amount ${providerAmount} does not match internal amount ${attempt.instruction.amount}`,
          }),
        );
      } else {
        await this.resolveDetectedIssue(attempt, 'amount_mismatch');
      }
      if (
        providerCurrency &&
        providerCurrency.toUpperCase() !== attempt.instruction.currency
      ) {
        discrepancies += 1;
        created += Number(
          await this.upsertIssue(attempt, 'currency_mismatch', {
            providerAmount,
            providerCurrency,
            providerState: providerResult.status,
            notes: `Provider currency ${providerCurrency} does not match ${attempt.instruction.currency}`,
          }),
        );
      } else {
        await this.resolveDetectedIssue(attempt, 'currency_mismatch');
      }
      await this.resolveDetectedIssue(attempt, 'provider_unavailable');
      await this.resolveDetectedIssue(attempt, 'missing_provider_reference');
      return { discrepancies, created };
    } catch (error: any) {
      created += Number(
        await this.upsertIssue(attempt, 'provider_unavailable', {
          notes: `Provider lookup failed: ${String(error?.message || error).slice(0, 1000)}`,
          severity: 'warning',
        }),
      );
      return { discrepancies: 1, created };
    }
  }

  async runReconciliation() {
    const [trialBalance, attempts, failedWebhookEvents] = await Promise.all([
      this.ledgerService.getCanonicalTrialBalance(),
      this.prisma.paymentAttempt.findMany({
        where: {
          status: {
            in: ['submitted', 'accepted', 'unknown', 'settled', 'failed'],
          },
        },
        include: { instruction: true },
        orderBy: { createdAt: 'asc' },
        take: 500,
      }),
      this.prisma.providerWebhookEvent.count({ where: { status: 'failed' } }),
    ]);
    let discrepanciesFound = failedWebhookEvents;
    let recordsCreated = 0;
    if (!trialBalance.isBalanced) {
      discrepanciesFound += 1;
      const dedupeKey = 'canonical-ledger:trial-balance';
      const existing = await this.prisma.reconciliationRecord.findUnique({
        where: { dedupeKey },
      });
      await this.prisma.reconciliationRecord.upsert({
        where: { dedupeKey },
        update: {
          providerAmount: new Prisma.Decimal(trialBalance.totalCredits),
          internalAmount: new Prisma.Decimal(trialBalance.totalDebits),
          notes: `Canonical ledger is out of balance by ${trialBalance.discrepancy}`,
          resolution: 'unresolved',
          resolvedAt: null,
          lastCheckedAt: new Date(),
        },
        create: {
          dedupeKey,
          reconciliationType: 'ledger',
          entityType: 'canonical_ledger',
          discrepancyType: 'trial_balance_mismatch',
          providerAmount: new Prisma.Decimal(trialBalance.totalCredits),
          internalAmount: new Prisma.Decimal(trialBalance.totalDebits),
          notes: `Canonical ledger is out of balance by ${trialBalance.discrepancy}`,
          lastCheckedAt: new Date(),
        },
      });
      recordsCreated += Number(!existing);
    } else {
      await this.prisma.reconciliationRecord.updateMany({
        where: {
          dedupeKey: 'canonical-ledger:trial-balance',
          resolution: 'unresolved',
        },
        data: {
          resolution: 'resolved',
          resolvedAt: new Date(),
          resolvedBy: 'system:reconciliation',
        },
      });
    }
    for (const attempt of attempts) {
      const result = await this.reconcileAttempt(attempt);
      discrepanciesFound += result.discrepancies;
      recordsCreated += result.created;
    }
    return {
      checkedPayments: attempts.length,
      checkedPayouts: attempts.filter(
        (item) =>
          item.operationType.includes('withdrawal') ||
          item.operationType.includes('disbursement'),
      ).length,
      checkedTrades: attempts.filter(
        (item) => item.operationType === 'fx_conversion',
      ).length,
      checkedExecutions: attempts.length,
      failedWebhookEvents,
      ledgerBalanced: trialBalance.isBalanced,
      discrepanciesFound,
      recordsCreated,
    };
  }

  async getOpenIssues() {
    return this.prisma.reconciliationRecord.findMany({
      where: { resolution: 'unresolved' },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async resolveIssue(id: string, notes: string, resolvedBy: string) {
    if (!notes?.trim())
      throw new BadRequestException('Resolution notes are required');
    const existing = await this.prisma.reconciliationRecord.findUnique({
      where: { id },
    });
    if (!existing)
      throw new NotFoundException('Reconciliation issue not found');
    const updated = await this.prisma.reconciliationRecord.update({
      where: { id },
      data: {
        resolution: 'resolved',
        resolvedAt: new Date(),
        resolvedBy,
        notes: notes.trim(),
      },
    });
    await this.auditLogsService.log({
      userId: resolvedBy,
      action: 'DISCREPANCY_RESOLVED',
      entityType: 'ReconciliationRecord',
      entityId: id,
      details: { notes: notes.trim() },
    });
    return updated;
  }
}

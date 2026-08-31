import { Injectable, Logger, Inject, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { LedgerService } from '../ledger/ledger.service';
import { CybridConfigService } from '../../infrastructure/providers/cybrid/cybrid-config.service';
import type { IFinancialProvider } from '../../core/interfaces/financial-provider.interface';

@Injectable()
export class ReconciliationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReconciliationService.name);
  private reconciliationTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
    private readonly ledgerService: LedgerService,
    private readonly config: CybridConfigService,
    @Inject('IFinancialProvider') private readonly cybridProvider: IFinancialProvider,
  ) {}

  onModuleInit() {
    // 5-minute automated reconciliation loop (300,000 ms)
    const intervalMs = 5 * 60 * 1000;
    this.reconciliationTimer = setInterval(() => {
      this.runReconciliation().catch((err) => {
        this.logger.error(`Automated periodic reconciliation error: ${err.message}`);
      });
    }, intervalMs);
    this.logger.log(`Scheduled automated Cybrid reconciliation to run every 5 minutes.`);
  }

  onModuleDestroy() {
    if (this.reconciliationTimer) {
      clearInterval(this.reconciliationTimer);
      this.reconciliationTimer = null;
    }
  }

  async runReconciliation(): Promise<{
    checkedPayments: number;
    checkedPayouts: number;
    checkedTrades: number;
    checkedExecutions: number;
    discrepanciesFound: number;
    recordsCreated: number;
  }> {
    this.logger.log('Starting automated Cybrid ↔ AgncyPay reconciliation audit...');

    let discrepanciesFound = 0;
    let recordsCreated = 0;
    let checkedTrades = 0;
    let checkedExecutions = 0;

    // 1. Reconcile Inbound Payments
    const pendingPayments = await this.prisma.payment.findMany({
      where: { status: 'PENDING_FUNDING', cybridTransferGuid: { not: null } },
    });

    for (const payment of pendingPayments) {
      if (this.config.isConfigured && payment.cybridTransferGuid) {
        try {
          const cybridTransfer = await this.cybridProvider.getTransfer(payment.cybridTransferGuid);

          if (cybridTransfer.state === 'completed') {
            discrepanciesFound++;
            await this.createDiscrepancy({
              reconciliationType: 'transfer',
              entityType: 'payment',
              entityId: payment.id,
              cybridState: cybridTransfer.state,
              internalState: payment.status,
              cybridAmount: cybridTransfer.amount !== undefined ? cybridTransfer.amount / 100 : Number(payment.amount),
              internalAmount: Number(payment.amount),
              discrepancyType: 'status_mismatch',
              notes: `Cybrid reports transfer ${payment.cybridTransferGuid} is completed, but payment was PENDING_FUNDING`,
            });
            recordsCreated++;
          }
        } catch (err) {
          this.logger.warn(`Could not check transfer ${payment.cybridTransferGuid}: ${err.message}`);
        }
      }
    }

    // 2. Reconcile Outbound Domestic Payouts (Transfers)
    const pendingPayoutTransfers = await this.prisma.paymentPayout.findMany({
      where: {
        status: { in: ['TRANSFER_PENDING', 'VALIDATING', 'QUOTE_PENDING'] },
        cybridTransferGuid: { not: null },
      },
    });

    for (const payout of pendingPayoutTransfers) {
      if (this.config.isConfigured && payout.cybridTransferGuid) {
        try {
          const cybridTransfer = await this.cybridProvider.getTransfer(payout.cybridTransferGuid);

          if (cybridTransfer.state === 'completed' && payout.status !== 'COMPLETED') {
            discrepanciesFound++;
            await this.createDiscrepancy({
              reconciliationType: 'transfer',
              entityType: 'payout',
              entityId: payout.id,
              cybridState: cybridTransfer.state,
              internalState: payout.status,
              cybridAmount: cybridTransfer.amount !== undefined ? cybridTransfer.amount / 100 : Number(payout.amount),
              internalAmount: Number(payout.amount),
              discrepancyType: 'status_mismatch',
              notes: `Cybrid reports transfer ${payout.cybridTransferGuid} is completed, but payout was ${payout.status}`,
            });
            recordsCreated++;
          }
        } catch (err) {
          this.logger.warn(`Could not check payout transfer ${payout.cybridTransferGuid}: ${err.message}`);
        }
      }
    }

    // 3. Reconcile International FX Trades
    const pendingPayoutTrades = await this.prisma.paymentPayout.findMany({
      where: {
        status: 'TRADE_PENDING',
        cybridTradeGuid: { not: null },
      },
    });
    checkedTrades = pendingPayoutTrades.length;

    for (const payout of pendingPayoutTrades) {
      if (this.config.isConfigured && payout.cybridTradeGuid) {
        try {
          const cybridTrade = await this.cybridProvider.getTrade(payout.cybridTradeGuid);

          if (cybridTrade.state === 'completed') {
            discrepanciesFound++;
            await this.createDiscrepancy({
              reconciliationType: 'trade',
              entityType: 'payout',
              entityId: payout.id,
              cybridState: cybridTrade.state,
              internalState: payout.status,
              cybridAmount: cybridTrade.deliverAmount !== undefined ? cybridTrade.deliverAmount / 100 : Number(payout.amount),
              internalAmount: Number(payout.amount),
              discrepancyType: 'status_mismatch',
              notes: `Cybrid reports FX trade ${payout.cybridTradeGuid} is completed, but payout status was TRADE_PENDING`,
            });
            recordsCreated++;
          }
        } catch (err) {
          this.logger.warn(`Could not check payout trade ${payout.cybridTradeGuid}: ${err.message}`);
        }
      }
    }

    // 4. Reconcile International Remittance Executions
    const pendingPayoutExecutions = await this.prisma.paymentPayout.findMany({
      where: {
        status: { in: ['REMITTANCE_PENDING', 'EXECUTION_PENDING', 'REMITTANCE_PROCESSING'] },
        cybridExecutionGuid: { not: null },
      },
    });
    checkedExecutions = pendingPayoutExecutions.length;

    for (const payout of pendingPayoutExecutions) {
      if (this.config.isConfigured && payout.cybridExecutionGuid) {
        try {
          const cybridExec = await this.cybridProvider.getExecution(payout.cybridExecutionGuid);

          if (cybridExec.state === 'completed' && payout.status !== 'COMPLETED') {
            discrepanciesFound++;
            await this.createDiscrepancy({
              reconciliationType: 'execution',
              entityType: 'payout',
              entityId: payout.id,
              cybridState: cybridExec.state,
              internalState: payout.status,
              cybridAmount: Number(payout.amount),
              internalAmount: Number(payout.amount),
              discrepancyType: 'status_mismatch',
              notes: `Cybrid reports execution ${payout.cybridExecutionGuid} is completed, but payout was ${payout.status}`,
            });
            recordsCreated++;
          }
        } catch (err) {
          this.logger.warn(`Could not check payout execution ${payout.cybridExecutionGuid}: ${err.message}`);
        }
      }
    }

    // 5. Balance Reconciliation for Agencies (USD & USDC)
    const agencies = await this.prisma.user.findMany({
      where: { accountType: 'agency' },
      include: { cybridCustomer: { include: { accounts: true } } },
    });

    for (const agency of agencies) {
      if (!agency.cybridCustomer) continue;

      const usdAccount = agency.cybridCustomer.accounts.find((a) => a.asset === 'USD');
      if (usdAccount && this.config.isConfigured) {
        try {
          const cybridAcc = await this.cybridProvider.getAccount(usdAccount.cybridAccountGuid);
          const platformBal = cybridAcc.platformBalance ? parseFloat(cybridAcc.platformBalance) / 100 : (cybridAcc.platformAvailable ? parseFloat(cybridAcc.platformAvailable) : 0);
          const ledgerBal = await this.ledgerService.getAccountBalance(`AGENCY:${agency.id}:USD`);

          if (Math.abs(platformBal - ledgerBal.balance) > 0.01) {
            discrepanciesFound++;
            await this.createDiscrepancy({
              reconciliationType: 'balance',
              entityType: 'agency_balance_usd',
              entityId: agency.id,
              cybridState: `platform_balance:${platformBal}`,
              internalState: `ledger_balance:${ledgerBal.balance}`,
              cybridAmount: platformBal,
              internalAmount: ledgerBal.balance,
              discrepancyType: 'amount_mismatch',
              notes: `Agency ${agency.id} USD balance mismatch: Cybrid ($${platformBal}) vs Ledger ($${ledgerBal.balance})`,
            });
            recordsCreated++;
          }
        } catch (err) {
          this.logger.warn(`Could not reconcile agency balance for ${agency.id}: ${err.message}`);
        }
      }
    }

    this.logger.log(
      `Reconciliation completed: ${discrepanciesFound} discrepancies detected, ${recordsCreated} records generated.`,
    );

    return {
      checkedPayments: pendingPayments.length,
      checkedPayouts: pendingPayoutTransfers.length,
      checkedTrades,
      checkedExecutions,
      discrepanciesFound,
      recordsCreated,
    };
  }

  private async createDiscrepancy(data: {
    reconciliationType: string;
    entityType: string;
    entityId?: string;
    cybridState?: string;
    internalState?: string;
    cybridAmount?: number | any;
    internalAmount?: number | any;
    discrepancyType?: string;
    notes?: string;
  }) {
    return this.prisma.reconciliationRecord.create({
      data: {
        reconciliationType: data.reconciliationType,
        entityType: data.entityType,
        entityId: data.entityId,
        cybridState: data.cybridState,
        internalState: data.internalState,
        cybridAmount: data.cybridAmount as any,
        internalAmount: data.internalAmount as any,
        discrepancyType: data.discrepancyType,
        resolution: 'unresolved',
        notes: data.notes,
      },
    });
  }

  async getOpenIssues() {
    return this.prisma.reconciliationRecord.findMany({
      where: { resolution: 'unresolved' },
      orderBy: { createdAt: 'desc' },
    });
  }

  async resolveIssue(id: string, notes: string, resolvedBy?: string) {
    return this.prisma.reconciliationRecord.update({
      where: { id },
      data: {
        resolution: 'resolved',
        resolvedAt: new Date(),
        resolvedBy: resolvedBy || 'system_admin',
        notes: notes ? `Resolved: ${notes}` : undefined,
      },
    });
  }
}

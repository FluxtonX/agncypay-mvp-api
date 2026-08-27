import { Injectable, Logger, Inject } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { LedgerService } from '../ledger/ledger.service';
import { CybridConfigService } from '../../infrastructure/providers/cybrid/cybrid-config.service';
import type { IFinancialProvider } from '../../core/interfaces/financial-provider.interface';

@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
    private readonly ledgerService: LedgerService,
    private readonly config: CybridConfigService,
    @Inject('IFinancialProvider') private readonly cybridProvider: IFinancialProvider,
  ) {}

  async runReconciliation(): Promise<{
    checkedPayments: number;
    checkedPayouts: number;
    discrepanciesFound: number;
    recordsCreated: number;
  }> {
    this.logger.log('Starting automated Cybrid ↔ AgncyPay reconciliation audit...');

    let discrepanciesFound = 0;
    let recordsCreated = 0;

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
              cybridAmount: cybridTransfer.amount ? parseFloat(cybridTransfer.amount) / 100 : payment.amount,
              internalAmount: payment.amount,
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

    // 2. Reconcile Outbound Payouts
    const pendingPayouts = await this.prisma.paymentPayout.findMany({
      where: {
        status: { in: ['TRANSFER_PENDING', 'TRADE_PENDING'] },
        cybridTransferGuid: { not: null },
      },
    });

    for (const payout of pendingPayouts) {
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
              cybridAmount: cybridTransfer.amount ? parseFloat(cybridTransfer.amount) / 100 : payout.amount,
              internalAmount: payout.amount,
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

    // 3. Balance Reconciliation for Agencies
    const agencies = await this.prisma.user.findMany({
      where: { accountType: 'agency' },
      include: { cybridCustomer: { include: { accounts: true } } },
    });

    for (const agency of agencies) {
      const ledgerBal = await this.ledgerService.getAccountBalance(`AGENCY:${agency.id}:USD`);
      const usdAccount = agency.cybridCustomer?.accounts.find((a) => a.asset === 'USD');

      if (usdAccount && this.config.isConfigured) {
        try {
          const cybridAcc = await this.cybridProvider.getAccount(usdAccount.cybridAccountGuid);
          const platformBal = cybridAcc.platformAvailable ? parseFloat(cybridAcc.platformAvailable) : 0;

          if (Math.abs(platformBal - ledgerBal.balance) > 0.01) {
            discrepanciesFound++;
            await this.createDiscrepancy({
              reconciliationType: 'balance',
              entityType: 'agency_balance',
              entityId: agency.id,
              cybridState: `platformAvailable: $${platformBal}`,
              internalState: `ledgerBalance: $${ledgerBal.balance}`,
              cybridAmount: platformBal,
              internalAmount: ledgerBal.balance,
              discrepancyType: 'amount_mismatch',
              notes: `Agency ${agency.id} balance mismatch: Cybrid ($${platformBal}) vs Ledger ($${ledgerBal.balance})`,
            });
            recordsCreated++;
          }
        } catch (err) {
          this.logger.warn(`Could not check Cybrid balance for agency ${agency.id}`);
        }
      }
    }

    this.logger.log(
      `Reconciliation completed: ${discrepanciesFound} discrepancies detected, ${recordsCreated} records generated.`,
    );

    return {
      checkedPayments: pendingPayments.length,
      checkedPayouts: pendingPayouts.length,
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
    cybridAmount?: number;
    internalAmount?: number;
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
        cybridAmount: data.cybridAmount,
        internalAmount: data.internalAmount,
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

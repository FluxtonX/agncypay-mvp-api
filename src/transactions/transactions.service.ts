import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TransactionRepository } from '../infrastructure/database/repositories/transaction.repository';
import { AuditLogsService } from '../modules/audit-logs/audit-logs.service';
import { TransactionStatus } from '@prisma/client';

@Injectable()
export class TransactionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactionRepo: TransactionRepository,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  async getTransactions(userId?: string) {
    return this.transactionRepo.findMany(userId ? { userId } : {});
  }

  async createTransaction(data: {
    invoiceId?: string;
    userId: string;
    amount: number;
    paymentMethod?: string;
    status?: TransactionStatus;
  }) {
    let invoiceId = data.invoiceId;
    if (!invoiceId) {
      const firstInvoice = await this.prisma.invoice.findFirst();
      if (firstInvoice) {
        invoiceId = firstInvoice.id;
      } else {
        const demoInv = await this.prisma.invoice.create({
          data: {
            id: `W-INV-TX-${Date.now()}`,
            invoiceNumber: `W-INV-TX-${Date.now()}`,
            agencyId: data.userId,
            agencyEmail: 'agency@elite.com',
            brandId: data.userId,
            brandName: 'Brand',
            brandEmail: 'brand@nike.com',
            amount: data.amount,
            due: '15/08/2026',
            createdDate: '01/08/2026',
          },
        });
        invoiceId = demoInv.id;
      }
    }

    const tx = await this.transactionRepo.create({
      invoiceId,
      userId: data.userId,
      amount: data.amount,
      paymentMethod: data.paymentMethod || 'Card',
      status: data.status || TransactionStatus.success,
    });

    await this.auditLogsService.log({
      userId: data.userId,
      action: 'TRANSACTION_CREATED',
      entityType: 'Transaction',
      entityId: tx.id,
      details: { amount: tx.amount, paymentMethod: tx.paymentMethod, status: tx.status },
    });

    return tx;
  }
}


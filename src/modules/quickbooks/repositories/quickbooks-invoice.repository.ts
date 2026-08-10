import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { QuickBooksInvoice, Prisma } from '@prisma/client';

@Injectable()
export class QuickBooksInvoiceRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByAgencyId(agencyId: string): Promise<QuickBooksInvoice[]> {
    return this.prisma.quickBooksInvoice.findMany({
      where: { agencyId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async upsertInvoice(data: {
    agencyId: string;
    quickbooksInvoiceId: string;
    invoiceNumber: string;
    customerName: string;
    amount: number;
    currency?: string;
    issueDate: string;
    dueDate: string;
    status: string;
    rawPayload?: any;
  }): Promise<QuickBooksInvoice> {
    return this.prisma.quickBooksInvoice.upsert({
      where: {
        agencyId_quickbooksInvoiceId: {
          agencyId: data.agencyId,
          quickbooksInvoiceId: data.quickbooksInvoiceId,
        },
      },
      update: {
        invoiceNumber: data.invoiceNumber,
        customerName: data.customerName,
        amount: data.amount,
        currency: data.currency || 'USD',
        issueDate: data.issueDate,
        dueDate: data.dueDate,
        status: data.status,
        syncedAt: new Date(),
        rawPayload: data.rawPayload || {},
      },
      create: {
        agencyId: data.agencyId,
        quickbooksInvoiceId: data.quickbooksInvoiceId,
        invoiceNumber: data.invoiceNumber,
        customerName: data.customerName,
        amount: data.amount,
        currency: data.currency || 'USD',
        issueDate: data.issueDate,
        dueDate: data.dueDate,
        status: data.status,
        rawPayload: data.rawPayload || {},
      },
    });
  }
}

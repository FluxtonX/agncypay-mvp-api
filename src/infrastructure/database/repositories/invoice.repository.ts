import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { Invoice, Prisma } from '@prisma/client';
import { IBaseRepository } from '../../../core/base/base.repository.interface';

@Injectable()
export class InvoiceRepository implements IBaseRepository<Invoice> {
  constructor(private readonly prisma: PrismaService) {}

  async findMany(filter: Prisma.InvoiceWhereInput = {}): Promise<Invoice[]> {
    return this.prisma.invoice.findMany({
      where: { ...filter, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(id: string): Promise<Invoice | null> {
    return this.prisma.invoice.findFirst({
      where: { id, deletedAt: null },
    });
  }

  async create(data: Prisma.InvoiceUncheckedCreateInput): Promise<Invoice> {
    return this.prisma.invoice.create({ data });
  }

  async update(id: string, data: Prisma.InvoiceUncheckedUpdateInput): Promise<Invoice> {
    return this.prisma.invoice.update({
      where: { id },
      data,
    });
  }

  async softDelete(id: string): Promise<Invoice> {
    return this.prisma.invoice.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}

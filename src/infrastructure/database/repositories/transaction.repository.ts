import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { Transaction, Prisma } from '@prisma/client';
import { IBaseRepository } from '../../../core/base/base.repository.interface';

@Injectable()
export class TransactionRepository implements IBaseRepository<Transaction> {
  constructor(private readonly prisma: PrismaService) {}

  async findMany(filter: Prisma.TransactionWhereInput = {}): Promise<Transaction[]> {
    return this.prisma.transaction.findMany({
      where: { ...filter, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(id: string): Promise<Transaction | null> {
    return this.prisma.transaction.findFirst({
      where: { id, deletedAt: null },
    });
  }

  async create(data: Prisma.TransactionUncheckedCreateInput): Promise<Transaction> {
    return this.prisma.transaction.create({ data });
  }

  async update(id: string, data: Prisma.TransactionUncheckedUpdateInput): Promise<Transaction> {
    return this.prisma.transaction.update({
      where: { id },
      data,
    });
  }

  async softDelete(id: string): Promise<Transaction> {
    return this.prisma.transaction.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}

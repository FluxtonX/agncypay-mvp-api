import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLog, Prisma } from '@prisma/client';

@Injectable()
export class AuditLogRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: Prisma.AuditLogCreateInput): Promise<AuditLog> {
    return this.prisma.auditLog.create({ data });
  }

  async findMany(filter: Prisma.AuditLogWhereInput = {}): Promise<AuditLog[]> {
    return this.prisma.auditLog.findMany({
      where: filter,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }
}

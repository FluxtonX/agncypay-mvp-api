import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { Workspace, Prisma } from '@prisma/client';
import { IBaseRepository } from '../../../core/base/base.repository.interface';

@Injectable()
export class WorkspaceRepository implements IBaseRepository<Workspace> {
  constructor(private readonly prisma: PrismaService) {}

  async findMany(filter: Prisma.WorkspaceWhereInput = {}): Promise<Workspace[]> {
    return this.prisma.workspace.findMany({
      where: { ...filter, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(id: string): Promise<Workspace | null> {
    return this.prisma.workspace.findFirst({
      where: { id, deletedAt: null },
    });
  }

  async create(data: Prisma.WorkspaceUncheckedCreateInput): Promise<Workspace> {
    return this.prisma.workspace.create({ data });
  }

  async update(id: string, data: Prisma.WorkspaceUncheckedUpdateInput): Promise<Workspace> {
    return this.prisma.workspace.update({
      where: { id },
      data,
    });
  }

  async softDelete(id: string): Promise<Workspace> {
    return this.prisma.workspace.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}

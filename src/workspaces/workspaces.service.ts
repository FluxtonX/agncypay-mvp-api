import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WorkspaceType, WorkspaceRole, Prisma } from '@prisma/client';

@Injectable()
export class WorkspacesService {
  constructor(private readonly prisma: PrismaService) {}

  async getUserWorkspaces(userId: string) {
    const memberships = await this.prisma.membership.findMany({
      where: { userId },
      include: { workspace: true },
    });

    return memberships.map((m: any) => ({
      ...m.workspace,
      role: m.role,
      permissions: m.permissions,
    }));
  }

  async createWorkspace(userId: string, data: { name: string; type: WorkspaceType }) {
    const agncyId = `WS-${Math.floor(100000 + Math.random() * 900000)}`;

    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const workspace = await tx.workspace.create({
        data: {
          name: data.name,
          type: data.type,
          agncyId,
          ownerId: userId,
          verificationTrack: 'kyb',
          verificationStatus: 'draft',
        },
      });

      await tx.membership.create({
        data: {
          userId,
          workspaceId: workspace.id,
          role: data.type === 'agency' ? WorkspaceRole.agency_admin : WorkspaceRole.admin,
          permissions: ['approve_invoices', 'initiate_payments', 'view_treasury', 'manage_team', 'view_reports'],
          status: 'active',
        },
      });

      return workspace;
    });
  }

  async updateWorkspace(userId: string, workspaceId: string, data: { name?: string }) {
    const membership = await this.prisma.membership.findUnique({
      where: {
        userId_workspaceId: { userId, workspaceId },
      },
    });

    if (!membership) {
      throw new NotFoundException('Workspace not found or unauthorized');
    }

    return this.prisma.workspace.update({
      where: { id: workspaceId },
      data,
    });
  }
}

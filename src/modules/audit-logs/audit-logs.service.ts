import { Injectable } from '@nestjs/common';
import { AuditLogRepository } from '../../infrastructure/database/repositories/audit-log.repository';
import { AuditLog } from '@prisma/client';

@Injectable()
export class AuditLogsService {
  constructor(private readonly auditLogRepo: AuditLogRepository) {}

  async log(params: {
    userId?: string;
    workspaceId?: string;
    action: string;
    entityType: string;
    entityId?: string;
    details?: Record<string, any>;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<AuditLog> {
    return this.auditLogRepo.create({
      userId: params.userId,
      workspaceId: params.workspaceId,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      details: params.details || {},
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
    });
  }

  async getLogs(userId?: string): Promise<AuditLog[]> {
    return this.auditLogRepo.findMany(userId ? { userId } : {});
  }
}

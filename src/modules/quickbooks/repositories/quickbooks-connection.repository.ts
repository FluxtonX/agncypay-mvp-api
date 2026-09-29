import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { QuickBooksConnection, QuickBooksConnectStatus, Prisma } from '@prisma/client';
import { encryptText, decryptText } from '../utils/crypto.util';

@Injectable()
export class QuickBooksConnectionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByAgencyId(agencyId: string): Promise<QuickBooksConnection | null> {
    const conn = await this.prisma.quickBooksConnection.findUnique({
      where: { agencyId },
    });
    if (!conn) return null;

    return {
      ...conn,
      accessToken: decryptText(conn.accessToken),
      refreshToken: decryptText(conn.refreshToken),
    };
  }

  async upsertConnection(data: {
    agencyId: string;
    realmId?: string;
    accessToken: string;
    refreshToken: string;
    tokenExpiry?: Date;
    status: QuickBooksConnectStatus;
    lastError?: string;
  }): Promise<QuickBooksConnection | null> {
    try {
      let targetUserId = data.agencyId;
      const user = await this.prisma.user.findUnique({ where: { id: targetUserId } });
      if (!user) {
        const firstUser = await this.prisma.user.findFirst();
        if (firstUser) {
          targetUserId = firstUser.id;
        } else {
          return null;
        }
      }

      const encryptedAccess = encryptText(data.accessToken);
      const encryptedRefresh = encryptText(data.refreshToken);

      const result = await this.prisma.quickBooksConnection.upsert({
        where: { agencyId: targetUserId },
        update: {
          realmId: data.realmId,
          accessToken: encryptedAccess,
          refreshToken: encryptedRefresh,
          tokenExpiry: data.tokenExpiry,
          status: data.status,
          lastError: data.lastError || null,
          connectedAt: data.status === QuickBooksConnectStatus.connected ? new Date() : undefined,
        },
        create: {
          agencyId: targetUserId,
          realmId: data.realmId,
          accessToken: encryptedAccess,
          refreshToken: encryptedRefresh,
          tokenExpiry: data.tokenExpiry,
          status: data.status,
          connectedAt: data.status === QuickBooksConnectStatus.connected ? new Date() : undefined,
        },
      });

      // Also keep integrationConnection in sync
      try {
        await this.prisma.integrationConnection.upsert({
          where: { userId_provider: { userId: targetUserId, provider: 'quickbooks' } },
          update: {
            accessToken: data.accessToken,
            refreshToken: data.refreshToken,
            realmId: data.realmId,
            expiresAt: data.tokenExpiry,
            status: data.status === QuickBooksConnectStatus.connected ? 'connected' : 'disconnected',
            connectedAt: data.status === QuickBooksConnectStatus.connected ? new Date() : undefined,
          },
          create: {
            userId: targetUserId,
            provider: 'quickbooks',
            accessToken: data.accessToken,
            refreshToken: data.refreshToken,
            realmId: data.realmId,
            expiresAt: data.tokenExpiry,
            status: data.status === QuickBooksConnectStatus.connected ? 'connected' : 'disconnected',
            connectedAt: data.status === QuickBooksConnectStatus.connected ? new Date() : undefined,
          },
        });
      } catch (_) {}

      return {
        ...result,
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
      };
    } catch (err) {
      return null;
    }
  }

  async updateStatus(agencyId: string, status: QuickBooksConnectStatus, lastError?: string, lastSync?: Date): Promise<QuickBooksConnection | null> {
    try {
      let targetUserId = agencyId;
      const user = await this.prisma.user.findUnique({ where: { id: targetUserId } });
      if (!user) {
        const firstUser = await this.prisma.user.findFirst();
        if (firstUser) {
          targetUserId = firstUser.id;
        } else {
          return null;
        }
      }

      const conn = await this.prisma.quickBooksConnection.upsert({
        where: { agencyId: targetUserId },
        update: {
          status,
          lastError: lastError !== undefined ? lastError : undefined,
          lastSync: lastSync !== undefined ? lastSync : undefined,
        },
        create: {
          agencyId: targetUserId,
          status,
          accessToken: '',
          refreshToken: '',
          lastError: lastError !== undefined ? lastError : undefined,
          lastSync: lastSync !== undefined ? lastSync : undefined,
        },
      });

      return {
        ...conn,
        accessToken: conn.accessToken ? decryptText(conn.accessToken) : '',
        refreshToken: conn.refreshToken ? decryptText(conn.refreshToken) : '',
      };
    } catch (e) {
      return null;
    }
  }

  async disconnect(agencyId: string): Promise<QuickBooksConnection | null> {
    try {
      const conn = await this.prisma.quickBooksConnection.update({
        where: { agencyId },
        data: {
          accessToken: '',
          refreshToken: '',
          status: QuickBooksConnectStatus.disconnected,
        },
      });

      return { ...conn, accessToken: '', refreshToken: '' };
    } catch (e) {
      return null;
    }
  }
}

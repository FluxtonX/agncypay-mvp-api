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
  }): Promise<QuickBooksConnection> {
    const encryptedAccess = encryptText(data.accessToken);
    const encryptedRefresh = encryptText(data.refreshToken);

    const result = await this.prisma.quickBooksConnection.upsert({
      where: { agencyId: data.agencyId },
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
        agencyId: data.agencyId,
        realmId: data.realmId,
        accessToken: encryptedAccess,
        refreshToken: encryptedRefresh,
        tokenExpiry: data.tokenExpiry,
        status: data.status,
        connectedAt: data.status === QuickBooksConnectStatus.connected ? new Date() : undefined,
      },
    });

    return {
      ...result,
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
    };
  }

  async updateStatus(agencyId: string, status: QuickBooksConnectStatus, lastError?: string, lastSync?: Date): Promise<QuickBooksConnection> {
    const conn = await this.prisma.quickBooksConnection.update({
      where: { agencyId },
      data: {
        status,
        lastError: lastError !== undefined ? lastError : undefined,
        lastSync: lastSync !== undefined ? lastSync : undefined,
      },
    });

    return {
      ...conn,
      accessToken: decryptText(conn.accessToken),
      refreshToken: decryptText(conn.refreshToken),
    };
  }

  async disconnect(agencyId: string): Promise<QuickBooksConnection> {
    const conn = await this.prisma.quickBooksConnection.update({
      where: { agencyId },
      data: {
        accessToken: '',
        refreshToken: '',
        status: QuickBooksConnectStatus.disconnected,
      },
    });

    return { ...conn, accessToken: '', refreshToken: '' };
  }
}

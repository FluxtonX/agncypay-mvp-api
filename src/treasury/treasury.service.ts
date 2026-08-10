import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../modules/audit-logs/audit-logs.service';

@Injectable()
export class TreasuryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  async getBalance(userId: string) {
    const treasury = await this.prisma.brandTreasury.findUnique({
      where: { userId },
    });
    return { balance: treasury ? treasury.balance : 0 };
  }

  async recordDeposit(userId: string, amount: number, paymentMethod: string) {
    const updatedTreasury = await this.prisma.brandTreasury.upsert({
      where: { userId },
      update: {
        balance: { increment: amount },
        lastDepositAmount: amount,
        lastDepositMethod: paymentMethod,
        lastUpdated: new Date(),
      },
      create: {
        userId,
        balance: amount,
        lastDepositAmount: amount,
        lastDepositMethod: paymentMethod,
      },
    });

    await this.auditLogsService.log({
      userId,
      action: 'TREASURY_DEPOSIT',
      entityType: 'BrandTreasury',
      entityId: updatedTreasury.id,
      details: { amount, paymentMethod, newBalance: updatedTreasury.balance },
    });

    return updatedTreasury;
  }
}


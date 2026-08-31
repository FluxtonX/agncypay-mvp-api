import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { Wallet, WalletLedger, Prisma, LedgerType } from '@prisma/client';
import { IBaseRepository } from '../../../core/base/base.repository.interface';
import { toDecimal, addDecimals, subDecimals, toNumber } from '../../../common/utils/decimal.util';

@Injectable()
export class WalletRepository implements IBaseRepository<Wallet> {
  constructor(private readonly prisma: PrismaService) {}

  async findMany(filter: Prisma.WalletWhereInput = {}): Promise<Wallet[]> {
    return this.prisma.wallet.findMany({
      where: { ...filter, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(id: string): Promise<Wallet | null> {
    return this.prisma.wallet.findFirst({
      where: { id, deletedAt: null },
    });
  }

  async findByUserId(userId: string): Promise<Wallet | null> {
    return this.prisma.wallet.findFirst({
      where: { userId, deletedAt: null },
    });
  }

  async findByWalletId(walletId: string): Promise<Wallet | null> {
    return this.prisma.wallet.findFirst({
      where: { walletId, deletedAt: null },
    });
  }

  async create(data: Prisma.WalletUncheckedCreateInput): Promise<Wallet> {
    return this.prisma.wallet.create({ data });
  }

  async update(id: string, data: Prisma.WalletUncheckedUpdateInput): Promise<Wallet> {
    return this.prisma.wallet.update({
      where: { id },
      data,
    });
  }

  async softDelete(id: string): Promise<Wallet> {
    return this.prisma.wallet.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  async addLedgerEntry(params: {
    walletId: string;
    type: LedgerType;
    amount: number | Prisma.Decimal;
    referenceType: string;
    referenceId?: string;
    description?: string;
  }): Promise<{ wallet: Wallet; ledgerEntry: WalletLedger }> {
    return this.prisma.$transaction(async (tx) => {
      const wallet = await tx.wallet.findUnique({ where: { id: params.walletId } });
      if (!wallet) throw new Error(`Wallet ${params.walletId} not found`);

      const newBalance =
        params.type === 'credit'
          ? addDecimals(wallet.balance, params.amount)
          : subDecimals(wallet.balance, params.amount);

      const updatedWallet = await tx.wallet.update({
        where: { id: wallet.id },
        data: { balance: newBalance },
      });

      const ledgerEntry = await tx.walletLedger.create({
        data: {
          walletId: wallet.id,
          type: params.type,
          amount: toDecimal(params.amount),
          balanceAfter: newBalance,
          referenceType: params.referenceType,
          referenceId: params.referenceId,
          description: params.description || '',
        },
      });

      return { wallet: updatedWallet, ledgerEntry };
    });
  }

  async getLedgerEntries(walletId: string): Promise<WalletLedger[]> {
    return this.prisma.walletLedger.findMany({
      where: { walletId },
      orderBy: { createdAt: 'desc' },
    });
  }
}

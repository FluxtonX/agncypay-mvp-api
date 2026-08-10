import { Injectable, NotFoundException } from '@nestjs/common';
import { WalletRepository } from '../../infrastructure/database/repositories/wallet.repository';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AccountType, LedgerType, Wallet } from '@prisma/client';

@Injectable()
export class WalletsService {
  constructor(
    private readonly walletRepo: WalletRepository,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  private generateWalletId(accountType: AccountType): string {
    const prefix = accountType === 'agency' ? 'WAL-AGY' : 'WAL-BRND';
    return `${prefix}-${Math.floor(100000 + Math.random() * 900000)}`;
  }

  async getOrCreateWalletForUser(userId: string, accountType: AccountType): Promise<Wallet> {
    let wallet = await this.walletRepo.findByUserId(userId);
    if (!wallet) {
      wallet = await this.walletRepo.create({
        walletId: this.generateWalletId(accountType),
        userId,
        accountType,
        balance: accountType === 'brand' ? 25000 : 0,
      });

      await this.auditLogsService.log({
        userId,
        action: 'WALLET_CREATED',
        entityType: 'Wallet',
        entityId: wallet.id,
        details: { walletId: wallet.walletId, accountType },
      });
    }
    return wallet;
  }

  async getWalletByUserId(userId: string): Promise<Wallet> {
    const wallet = await this.walletRepo.findByUserId(userId);
    if (!wallet) {
      throw new NotFoundException(`Wallet for user ${userId} not found`);
    }
    return wallet;
  }

  async getWalletByWalletId(walletId: string): Promise<Wallet> {
    const wallet = await this.walletRepo.findByWalletId(walletId);
    if (!wallet) {
      throw new NotFoundException(`Wallet ID ${walletId} not found`);
    }
    return wallet;
  }

  async getLedgerHistory(walletId: string) {
    const wallet = await this.getWalletByWalletId(walletId);
    const ledger = await this.walletRepo.getLedgerEntries(wallet.id);
    return { wallet, ledger };
  }

  async recordTransaction(params: {
    walletId: string;
    type: LedgerType;
    amount: number;
    referenceType: string;
    referenceId?: string;
    description?: string;
  }) {
    const result = await this.walletRepo.addLedgerEntry(params);

    await this.auditLogsService.log({
      userId: result.wallet.userId,
      action: `WALLET_${params.type.toUpperCase()}`,
      entityType: 'WalletLedger',
      entityId: result.ledgerEntry.id,
      details: { amount: params.amount, newBalance: result.wallet.balance, referenceType: params.referenceType },
    });

    return result;
  }
}

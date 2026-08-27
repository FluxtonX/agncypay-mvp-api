import { Injectable, NotFoundException, Optional } from '@nestjs/common';
import { WalletRepository } from '../../infrastructure/database/repositories/wallet.repository';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { PrismaService } from '../../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { AccountType, LedgerType, Wallet } from '@prisma/client';

@Injectable()
export class WalletsService {
  constructor(
    private readonly walletRepo: WalletRepository,
    private readonly auditLogsService: AuditLogsService,
    private readonly prisma: PrismaService,
    @Optional() private readonly ledgerService?: LedgerService,
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

    return this.syncWalletWithLedger(wallet);
  }

  async getWalletByUserId(userId: string): Promise<Wallet> {
    const wallet = await this.walletRepo.findByUserId(userId);
    if (!wallet) {
      throw new NotFoundException(`Wallet for user ${userId} not found`);
    }
    return this.syncWalletWithLedger(wallet);
  }

  async getWalletByWalletId(walletId: string): Promise<Wallet> {
    const wallet = await this.walletRepo.findByWalletId(walletId);
    if (!wallet) {
      throw new NotFoundException(`Wallet ID ${walletId} not found`);
    }
    return this.syncWalletWithLedger(wallet);
  }

  async syncWalletWithLedger(wallet: Wallet): Promise<Wallet> {
    if (!this.ledgerService) return wallet;

    try {
      const code = `AGENCY:${wallet.userId}:USD`;
      const accountBal = await this.ledgerService.getAccountBalance(code);
      if (accountBal.balance > 0 && accountBal.balance !== wallet.balance) {
        return this.walletRepo.update(wallet.id, { balance: accountBal.balance });
      }
    } catch (_) {}

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
    const syncedWallet = await this.syncWalletWithLedger(result.wallet);

    await this.auditLogsService.log({
      userId: result.wallet.userId,
      action: `WALLET_${params.type.toUpperCase()}`,
      entityType: 'WalletLedger',
      entityId: result.ledgerEntry.id,
      details: { amount: params.amount, newBalance: syncedWallet.balance, referenceType: params.referenceType },
    });

    return { wallet: syncedWallet, ledgerEntry: result.ledgerEntry };
  }
}

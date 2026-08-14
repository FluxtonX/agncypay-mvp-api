import { Module, Global } from '@nestjs/common';
import { WalletsService } from './wallets.service';
import { WalletsController } from './wallets.controller';
import { WalletRepository } from '../../infrastructure/database/repositories/wallet.repository';
import { ModernTreasuryProvider } from '../../infrastructure/providers/modern-treasury/modern-treasury.provider';
import { PrismaModule } from '../../prisma/prisma.module';

@Global()
@Module({
  imports: [PrismaModule],
  controllers: [WalletsController],
  providers: [WalletsService, WalletRepository, ModernTreasuryProvider],
  exports: [WalletsService, WalletRepository],
})
export class WalletsModule {}

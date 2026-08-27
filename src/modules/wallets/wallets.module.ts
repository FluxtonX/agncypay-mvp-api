import { Module, Global } from '@nestjs/common';
import { WalletsService } from './wallets.service';
import { WalletsController } from './wallets.controller';
import { WalletRepository } from '../../infrastructure/database/repositories/wallet.repository';
import { PrismaModule } from '../../prisma/prisma.module';

@Global()
@Module({
  imports: [PrismaModule],
  controllers: [WalletsController],
  providers: [WalletsService, WalletRepository],
  exports: [WalletsService, WalletRepository],
})
export class WalletsModule {}

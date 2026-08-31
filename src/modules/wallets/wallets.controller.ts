import { Controller, Get, Param, UseGuards, ForbiddenException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { WalletsService } from './wallets.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators';

@ApiTags('Wallet System')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('wallets')
export class WalletsController {
  constructor(private readonly walletsService: WalletsService) {}

  @ApiOperation({ summary: 'Get current user official Wallet profile & Wallet ID' })
  @Get('me')
  async getMyWallet(@CurrentUser('id') userId: string) {
    return this.walletsService.getWalletByUserId(userId);
  }

  @ApiOperation({ summary: 'Get Wallet & Ledger transactions by Wallet ID (Owned by authenticated user)' })
  @Get(':walletId/ledger')
  async getWalletLedger(
    @Param('walletId') walletId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.walletsService.getLedgerHistory(walletId, userId);
  }
}

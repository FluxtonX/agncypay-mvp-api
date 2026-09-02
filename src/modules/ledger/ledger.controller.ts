import { Controller, Get, Query, Param, UseGuards, ForbiddenException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { LedgerService } from './ledger.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators';

@ApiTags('Ledger (Double-Entry Accounting)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('ledger')
export class LedgerController {
  constructor(private readonly ledgerService: LedgerService) {}

  @ApiOperation({ summary: 'Get balance of a ledger account' })
  @Get('balance/:accountCode')
  async getBalance(
    @Param('accountCode') accountCode: string,
    @CurrentUser('id') userId: string,
  ) {
    // Tenant safety check: User can only query their own account or system clearing if authorized
    if (accountCode.startsWith('AGENCY:') && !accountCode.includes(userId)) {
      throw new ForbiddenException('Access denied to this ledger account');
    }
    return this.ledgerService.getAccountBalance(accountCode);
  }

  @ApiOperation({ summary: 'Get Agency internal ledger balance' })
  @Get('agency-balance')
  async getAgencyBalance(@CurrentUser('id') agencyId: string) {
    const usdCode = `AGENCY:${agencyId}:USD`;
    const usdcCode = `AGENCY:${agencyId}:USDC_TRADING`;

    const usdBalance = await this.ledgerService.getAccountBalance(usdCode);
    const usdcBalance = await this.ledgerService.getAccountBalance(usdcCode);

    return {
      usd: usdBalance,
      usdc: usdcBalance,
      totalAvailableUsd: usdBalance.balance,
    };
  }

  @ApiOperation({ summary: 'Get Journal entries history for the authenticated user' })
  @Get('journal')
  async getJournalHistory(
    @CurrentUser('id') userId: string,
    @Query('accountCode') accountCode?: string,
    @Query('limit') limit?: number,
  ) {
    const targetCode = accountCode || `AGENCY:${userId}:USD`;
    if (targetCode.startsWith('AGENCY:') && !targetCode.includes(userId)) {
      throw new ForbiddenException('Access denied to this ledger account history');
    }
    return this.ledgerService.getJournalHistory(targetCode, limit ? Number(limit) : 50);
  }

  @ApiOperation({ summary: 'Get time-range statement for ledger account' })
  @Get('statement')
  async getStatement(
    @CurrentUser('id') userId: string,
    @Query('accountCode') accountCode?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('limit') limit?: number,
  ) {
    const targetCode = accountCode || `AGENCY:${userId}:USD`;
    if (targetCode.startsWith('AGENCY:') && !targetCode.includes(userId)) {
      throw new ForbiddenException('Access denied to this ledger account statement');
    }

    return this.ledgerService.getStatement(targetCode, {
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      limit: limit ? Number(limit) : 100,
    });
  }

  @ApiOperation({ summary: 'Get global double-entry trial balance (Admin/Reconciliation)' })
  @Get('trial-balance')
  async getTrialBalance() {
    return this.ledgerService.getTrialBalance();
  }
}


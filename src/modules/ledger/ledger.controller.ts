import { Controller, Get, Query, Param, UseGuards } from '@nestjs/common';
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
  async getBalance(@Param('accountCode') accountCode: string) {
    return this.ledgerService.getAccountBalance(accountCode);
  }

  @ApiOperation({ summary: 'Get Agency internal ledger balance' })
  @Get('agency-balance')
  async getAgencyBalance(@CurrentUser('id') agencyId: string) {
    const code = `AGENCY:${agencyId}:USD`;
    return this.ledgerService.getAccountBalance(code);
  }

  @ApiOperation({ summary: 'Get Journal entries history' })
  @Get('journal')
  async getJournalHistory(
    @Query('accountCode') accountCode?: string,
    @Query('limit') limit?: number,
  ) {
    return this.ledgerService.getJournalHistory(accountCode, limit ? Number(limit) : 50);
  }
}

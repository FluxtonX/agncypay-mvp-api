import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { TreasuryService } from './treasury.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators';

@ApiTags('Brand Treasury')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('treasury')
export class TreasuryController {
  constructor(private readonly treasuryService: TreasuryService) {}

  @ApiOperation({ summary: 'Get current Brand treasury account balance' })
  @Get('balance')
  async getBalance(@CurrentUser('id') userId: string) {
    return this.treasuryService.getBalance(userId);
  }

  @ApiOperation({ summary: 'Record funds deposit to Brand treasury balance' })
  @Post('deposit')
  async recordDeposit(
    @CurrentUser('id') userId: string,
    @Body() body: { amount: number; paymentMethod?: string }
  ) {
    return this.treasuryService.recordDeposit(userId, body.amount, body.paymentMethod || 'Card');
  }
}


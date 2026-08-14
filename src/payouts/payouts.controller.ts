import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { PayoutsService } from './payouts.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators';

@ApiTags('Agency Payouts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('payouts')
export class PayoutsController {
  constructor(private readonly payoutsService: PayoutsService) {}

  @ApiOperation({ summary: 'Add a new External Account for Agency payouts' })
  @Post('external-accounts')
  async addExternalAccount(
    @CurrentUser('id') agencyId: string,
    @Body('accountName') accountName: string,
    @Body('bankName') bankName: string,
    @Body('accountNumber') accountNumber: string,
    @Body('routingNumber') routingNumber: string,
    @Body('isPrimary') isPrimary?: boolean,
  ) {
    return this.payoutsService.addAgencyExternalAccount({
      agencyId,
      accountName,
      bankName,
      accountNumber,
      routingNumber,
      isPrimary,
    });
  }

  @ApiOperation({ summary: 'Get all configured external payout accounts for Agency' })
  @Get('external-accounts')
  async getExternalAccounts(@CurrentUser('id') agencyId: string) {
    return this.payoutsService.getAgencyExternalAccounts(agencyId);
  }

  @ApiOperation({ summary: 'Request payout from Agency Internal Account to selected External Account' })
  @Post('request')
  async requestPayout(
    @CurrentUser('id') agencyId: string,
    @Body('amount') amount: number,
    @Body('destinationExternalAccountId') destinationExternalAccountId: string,
    @Body('paymentType') paymentType?: 'ach' | 'wire' | 'rtp',
  ) {
    return this.payoutsService.requestPayout({
      agencyId,
      amount,
      destinationExternalAccountId,
      paymentType,
    });
  }

  @ApiOperation({ summary: 'Get payout history for Agency' })
  @Get('history')
  async getPayoutHistory(@CurrentUser('id') agencyId: string) {
    return this.payoutsService.getPayoutHistory(agencyId);
  }
}

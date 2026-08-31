import { Controller, Get, Post, Body, Headers, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiHeader } from '@nestjs/swagger';
import { PayoutsService } from './payouts.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators';

@ApiTags('Agency Payouts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('payouts')
export class PayoutsController {
  constructor(private readonly payoutsService: PayoutsService) {}

  @ApiOperation({ summary: 'Request Domestic Talent Payout via Cybrid transfer' })
  @ApiHeader({ name: 'Idempotency-Key', required: false, description: 'Unique idempotency key' })
  @Post('talent/domestic')
  async requestDomesticTalentPayout(
    @CurrentUser('id') agencyId: string,
    @Body('talentId') talentId: string,
    @Body('amount') amount: number,
    @Body('currency') currency?: string,
    @Body('paymentId') paymentId?: string,
    @Body('idempotencyKey') idempotencyKey?: string,
    @Headers('idempotency-key') headerIdempotencyKey?: string,
    @Headers('x-idempotency-key') headerXIdempotencyKey?: string,
    @Body('metadata') metadata?: Record<string, any>,
  ) {
    const finalIdempotencyKey = headerIdempotencyKey || headerXIdempotencyKey || idempotencyKey;
    return this.payoutsService.requestDomesticTalentPayout({
      agencyId,
      talentId,
      amount,
      currency,
      paymentId,
      idempotencyKey: finalIdempotencyKey,
      metadata,
    });
  }

  @ApiOperation({ summary: 'Request International Talent Payout via USD -> USDC FX Trade and Remittance' })
  @ApiHeader({ name: 'Idempotency-Key', required: false, description: 'Unique idempotency key' })
  @Post('talent/international')
  async requestInternationalTalentPayout(
    @CurrentUser('id') agencyId: string,
    @Body('talentId') talentId: string,
    @Body('amount') amount: number,
    @Body('destinationCurrency') destinationCurrency?: string,
    @Body('paymentId') paymentId?: string,
    @Body('idempotencyKey') idempotencyKey?: string,
    @Headers('idempotency-key') headerIdempotencyKey?: string,
    @Headers('x-idempotency-key') headerXIdempotencyKey?: string,
    @Body('metadata') metadata?: Record<string, any>,
  ) {
    const finalIdempotencyKey = headerIdempotencyKey || headerXIdempotencyKey || idempotencyKey;
    return this.payoutsService.requestInternationalTalentPayout({
      agencyId,
      talentId,
      amount,
      destinationCurrency,
      paymentId,
      idempotencyKey: finalIdempotencyKey,
      metadata,
    });
  }

  @ApiOperation({ summary: 'Request Agency self-withdrawal to linked External Bank Account' })
  @Post('request')
  async requestPayout(
    @CurrentUser('id') agencyId: string,
    @Body('amount') amount: number,
    @Body('destinationExternalAccountId') destinationExternalAccountId: string,
    @Body('paymentType') paymentType?: 'ach' | 'wire' | 'rtp',
  ) {
    return this.payoutsService.requestAgencyWithdrawal({
      agencyId,
      amount,
      destinationExternalAccountId,
      paymentType,
    });
  }

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

  @ApiOperation({ summary: 'Get payout history for Agency' })
  @Get('history')
  async getPayoutHistory(@CurrentUser('id') agencyId: string) {
    return this.payoutsService.getPayoutHistory(agencyId);
  }
}

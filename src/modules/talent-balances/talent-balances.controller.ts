import {
  Body,
  Controller,
  Get,
  Headers,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AuthorizationGuard } from '../../auth/guards/authorization.guard';
import { AccountTypes } from '../../auth/decorators/authorization.decorator';
import { CurrentUser } from '../../common/decorators';
import { TalentBalancesService } from './talent-balances.service';
import { TalentWithdrawalsService } from './talent-withdrawals.service';
import {
  TalentActivityQueryDto,
  TalentWithdrawalDto,
} from './talent-balance.dto';

@ApiTags('Talent AP Balance')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AuthorizationGuard)
@AccountTypes('talent')
@Controller('talent-balance')
export class TalentBalancesController {
  constructor(
    private readonly balances: TalentBalancesService,
    private readonly withdrawals: TalentWithdrawalsService,
  ) {}

  @ApiOperation({
    summary: 'Get authenticated Talent available, held, and withdrawn balances',
  })
  @Get()
  getBalance(@CurrentUser('id') userId: string) {
    return this.balances.getBalance(userId);
  }

  @ApiOperation({ summary: 'Get authenticated Talent balance activity' })
  @Get('activity')
  getActivity(
    @CurrentUser('id') userId: string,
    @Query() query: TalentActivityQueryDto,
  ) {
    return this.balances.getActivity(userId, query.limit);
  }

  @ApiOperation({
    summary: 'Withdraw available Talent AP balance to a verified bank',
  })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @Post('withdrawals')
  requestWithdrawal(
    @CurrentUser('id') userId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: TalentWithdrawalDto,
  ) {
    return this.withdrawals.request(userId, {
      ...body,
      idempotencyKey: idempotencyKey || '',
    });
  }
}

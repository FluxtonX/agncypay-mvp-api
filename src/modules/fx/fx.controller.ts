import {
  Body,
  Controller,
  Headers,
  Param,
  Post,
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
import { FxService } from './fx.service';
import { CreateFxQuoteDto } from './fx.dto';

@ApiTags('FX')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AuthorizationGuard)
@AccountTypes('talent')
@Controller('fx')
export class FxController {
  constructor(private readonly fx: FxService) {}

  @ApiOperation({
    summary:
      'Create a time-limited provider-independent Talent balance FX quote',
  })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @Post('quotes')
  createQuote(
    @CurrentUser('id') userId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: CreateFxQuoteDto,
  ) {
    return this.fx.createQuote(userId, {
      ...body,
      idempotencyKey: idempotencyKey || '',
    });
  }

  @ApiOperation({
    summary: 'Execute a locked FX quote against Talent AP balance',
  })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @Post('quotes/:quoteId/execute')
  executeQuote(
    @CurrentUser('id') userId: string,
    @Param('quoteId') quoteId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ) {
    return this.fx.executeQuote(userId, quoteId, idempotencyKey || '');
  }
}

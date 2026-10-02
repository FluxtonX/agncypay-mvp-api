import {
  Controller,
  Get,
  Post,
  Body,
  Headers,
  Param,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiHeader,
} from '@nestjs/swagger';
import { PaymentService } from './payment.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators';
import { AuthorizationGuard } from '../../auth/guards/authorization.guard';
import {
  AccountTypes,
  OrganizationRoles,
  Permissions,
} from '../../auth/decorators/authorization.decorator';
import { CreateBrandPaymentDto, ProvisionAgencyRailsDto } from './payment.dto';

@ApiTags('Payments (Brand → Agency)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AuthorizationGuard)
@Controller('payments')
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  @ApiOperation({
    summary:
      'Initiate a Brand → Agency payment and obtain deposit instructions',
  })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @Post()
  @AccountTypes('brand')
  @Permissions('initiate_payments')
  async createPayment(
    @CurrentUser('id') brandId: string,
    @Body() body: CreateBrandPaymentDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.paymentService.createPayment({
      brandId,
      ...body,
      idempotencyKey: idempotencyKey || '',
    });
  }

  @ApiOperation({
    summary:
      'Provision the authenticated Agency collection and payout bank rails',
  })
  @Post('agency/rails')
  @AccountTypes('agency')
  @OrganizationRoles('agency_owner')
  provisionAgencyRails(
    @CurrentUser('id') userId: string,
    @Body() body: ProvisionAgencyRailsDto,
  ) {
    return this.paymentService.provisionAgencyPaymentRails(userId, body);
  }

  @ApiOperation({
    summary: 'Get all payments for the authenticated user (Brand or Agency)',
  })
  @Get()
  async getPayments(@CurrentUser('id') userId: string) {
    return this.paymentService.getPayments(userId);
  }

  @ApiOperation({ summary: 'Get payment details by ID' })
  @Get(':id')
  async getPaymentById(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.paymentService.getPaymentById(id, userId);
  }

  @ApiOperation({
    summary: 'Get deposit bank account funding instructions for a payment',
  })
  @Get(':id/funding-instructions')
  async getFundingInstructions(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.paymentService.getFundingInstructions(id, userId);
  }
}

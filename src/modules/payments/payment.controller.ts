import { Controller, Get, Post, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { PaymentService } from './payment.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators';

@ApiTags('Payments (Brand → Agency)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('payments')
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  @ApiOperation({ summary: 'Initiate a Brand → Agency payment and obtain deposit instructions' })
  @Post()
  async createPayment(
    @CurrentUser('id') brandId: string,
    @Body('agencyId') agencyId: string,
    @Body('amount') amount: number,
    @Body('currency') currency?: string,
    @Body('invoiceId') invoiceId?: string,
    @Body('paymentMethod') paymentMethod?: string,
    @Body('metadata') metadata?: Record<string, any>,
  ) {
    return this.paymentService.createPayment({
      brandId,
      agencyId,
      amount,
      currency,
      invoiceId,
      paymentMethod,
      metadata,
    });
  }

  @ApiOperation({ summary: 'Get all payments for the authenticated user (Brand or Agency)' })
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

  @ApiOperation({ summary: 'Get deposit bank account funding instructions for a payment' })
  @Get(':id/funding-instructions')
  async getFundingInstructions(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.paymentService.getFundingInstructions(id, userId);
  }
}

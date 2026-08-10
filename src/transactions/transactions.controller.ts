import { Controller, Get, Post, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { TransactionsService } from './transactions.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators';
import { TransactionStatus } from '@prisma/client';

@ApiTags('Transactions')
@Controller('transactions')
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  @ApiOperation({ summary: 'Get transactions list' })
  @Get()
  async getTransactions(@Query('userId') userId?: string) {
    return this.transactionsService.getTransactions(userId);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Record financial transaction' })
  @Post()
  async createTransaction(
    @CurrentUser('id') userId: string,
    @Body() body: { invoiceId?: string; amount: number; paymentMethod?: string; status?: TransactionStatus }
  ) {
    return this.transactionsService.createTransaction({ userId, ...body });
  }
}


import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { TransactionsService } from './transactions.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators';
import { TransactionStatus } from '@prisma/client';

@ApiTags('Transactions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('transactions')
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  @ApiOperation({ summary: 'Get transactions list for authenticated user' })
  @Get()
  async getTransactions(@CurrentUser('id') userId: string) {
    return this.transactionsService.getTransactions(userId);
  }

  @ApiOperation({ summary: 'Record financial transaction' })
  @Post()
  async createTransaction(
    @CurrentUser('id') userId: string,
    @Body() body: { invoiceId?: string; amount: number; paymentMethod?: string; status?: TransactionStatus },
  ) {
    return this.transactionsService.createTransaction({ userId, ...body });
  }
}

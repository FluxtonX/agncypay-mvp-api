import { Controller, Get, Post, Query, Res, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Response } from 'express';
import { QuickBooksService } from './quickbooks.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators';

@ApiTags('QuickBooks')
@Controller('quickbooks')
export class QuickBooksController {
  constructor(private readonly quickbooksService: QuickBooksService) {}

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Generate QuickBooks OAuth 2.0 Authorization URL' })
  @Get('connect')
  async connect(@CurrentUser('id') agencyId: string) {
    return this.quickbooksService.getConnectUrl(agencyId);
  }

  @ApiOperation({ summary: 'QuickBooks OAuth 2.0 Callback handler' })
  @Get('callback')
  async callback(
    @Query('code') code: string,
    @Query('realmId') realmId: string,
    @Query('state') state: string,
    @Res() res: any,
  ) {
    const redirectUrl = await this.quickbooksService.handleCallback(code, realmId, state);
    return res.redirect(redirectUrl);
  }


  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Disconnect QuickBooks integration' })
  @Post('disconnect')
  async disconnect(@CurrentUser('id') agencyId: string) {
    return this.quickbooksService.disconnect(agencyId);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get active QuickBooks connection status' })
  @Get('status')
  async getStatus(@CurrentUser('id') agencyId: string) {
    return this.quickbooksService.getStatus(agencyId);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Trigger QuickBooks invoice synchronization' })
  @Post('fetch-invoices')
  async fetchInvoices(@CurrentUser('id') agencyId: string) {
    return this.quickbooksService.fetchInvoices(agencyId);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'List imported QuickBooks invoices' })
  @Get('invoices')
  async getInvoices(@CurrentUser('id') agencyId: string) {
    return this.quickbooksService.getInvoices(agencyId);
  }
}

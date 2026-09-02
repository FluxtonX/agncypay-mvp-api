import { Controller, Get, Post, Patch, Param, Body, UseGuards, ForbiddenException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { InvoicesService } from './invoices.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators';

@ApiTags('Invoices')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('invoices')
export class InvoicesController {
  constructor(private readonly invoicesService: InvoicesService) {}

  @ApiOperation({ summary: 'List all invoices for authenticated user (Agency or Brand)' })
  @Get()
  async getInvoices(@CurrentUser('id') userId: string) {
    return this.invoicesService.getInvoices(userId);
  }

  @ApiOperation({ summary: 'List registered brand accounts for invoice creation' })
  @Get('brands')
  async getBrands() {
    return this.invoicesService.getBrands();
  }

  @ApiOperation({ summary: 'Get single invoice by ID with tenant access check' })
  @Get(':id')
  async getInvoiceById(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.invoicesService.getInvoiceById(id, userId);
  }

  @ApiOperation({ summary: 'Create new invoice draft or send' })
  @Post()
  async createInvoice(
    @CurrentUser('id') userId: string,
    @Body() body: any,
  ) {
    return this.invoicesService.createInvoice({ ...body, currentUserId: userId });
  }

  @ApiOperation({ summary: 'Update invoice status' })
  @Patch(':id/status')
  async updateInvoiceStatus(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Body() body: { status: string; payoutStatus?: string },
  ) {
    return this.invoicesService.updateInvoiceStatus(id, body.status, body.payoutStatus, userId);
  }
}

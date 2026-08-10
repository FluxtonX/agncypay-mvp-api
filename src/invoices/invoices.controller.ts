import { Controller, Get, Post, Patch, Param, Body, Headers } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { InvoicesService } from './invoices.service';

@ApiTags('Invoices')
@Controller('invoices')
export class InvoicesController {
  constructor(private readonly invoicesService: InvoicesService) {}

  @ApiOperation({ summary: 'List all invoices' })
  @Get()
  async getInvoices() {
    return this.invoicesService.getInvoices();
  }

  @ApiOperation({ summary: 'List registered brand accounts for invoice creation' })
  @Get('brands')
  async getBrands() {
    return this.invoicesService.getBrands();
  }

  @ApiOperation({ summary: 'Get single invoice by ID' })
  @Get(':id')
  async getInvoiceById(@Param('id') id: string) {
    return this.invoicesService.getInvoiceById(id);
  }

  @ApiOperation({ summary: 'Create new invoice draft or send' })
  @Post()
  async createInvoice(@Body() body: any) {
    return this.invoicesService.createInvoice(body);
  }

  @ApiOperation({ summary: 'Update invoice status or trigger payout' })
  @Patch(':id/status')
  async updateInvoiceStatus(
    @Param('id') id: string,
    @Body() body: { status: string; payoutStatus?: string }
  ) {
    return this.invoicesService.updateInvoiceStatus(id, body.status, body.payoutStatus);
  }
}

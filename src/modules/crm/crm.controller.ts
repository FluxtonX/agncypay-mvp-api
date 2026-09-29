import { Controller, Post, Get, Body, Headers, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiHeader } from '@nestjs/swagger';
import { CrmService } from './crm.service';
import { CrmWebhookDto, CsvRosterImportDto } from './dto/crm-webhook.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators';

@ApiTags('CRM Integration & Payables Ingestion')
@Controller('crm')
export class CrmController {
  constructor(private readonly crmService: CrmService) {}

  @ApiOperation({ summary: 'Inbound generic CRM webhook (HubSpot, GoHighLevel, Airtable, Zapier)' })
  @ApiHeader({ name: 'X-AgncyPay-CRM-Key', required: false, description: 'Agency CRM Webhook API Key' })
  @Post('webhook')
  async handleWebhook(
    @Headers('x-agncypay-crm-key') apiKey: string | undefined,
    @Body() payload: CrmWebhookDto,
    @Req() req: any,
  ) {
    // If request also happens to carry a JWT user, pass it along
    const authAgencyId = req.user?.id;
    return this.crmService.handleWebhook(apiKey, payload, authAgencyId);
  }

  @ApiOperation({ summary: 'Get Agency CRM webhook configuration, endpoint URL, and API key' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('config')
  async getCrmConfig(@CurrentUser('id') agencyId: string) {
    return this.crmService.getCrmConfig(agencyId);
  }

  @ApiOperation({ summary: 'Bulk import Talent roster parsed from CSV export' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('import-roster')
  async importRoster(
    @CurrentUser('id') agencyId: string,
    @Body() dto: CsvRosterImportDto,
  ) {
    return this.crmService.importCsvRoster(agencyId, dto);
  }

  @ApiOperation({ summary: 'Get all pending payables ingested from CRM awaiting batch review & approval' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('payables/pending')
  async getPendingPayables(@CurrentUser('id') agencyId: string) {
    return this.crmService.getPendingPayables(agencyId);
  }
}

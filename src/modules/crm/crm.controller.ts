import {
  Controller,
  Post,
  Get,
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
import { CrmService } from './crm.service';
import { CrmWebhookDto, CsvRosterImportDto } from './dto/crm-webhook.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators';
import { AuthorizationGuard } from '../../auth/guards/authorization.guard';
import {
  AccountTypes,
  Permissions,
} from '../../auth/decorators/authorization.decorator';

@ApiTags('CRM Integration & Payables Ingestion')
@Controller('crm')
export class CrmController {
  constructor(private readonly crmService: CrmService) {}

  @ApiOperation({
    summary:
      'Inbound generic CRM webhook (HubSpot, GoHighLevel, Airtable, Zapier)',
  })
  @ApiHeader({
    name: 'X-AgncyPay-CRM-Key',
    required: true,
    description: 'Connection-scoped CRM webhook API key',
  })
  @ApiHeader({
    name: 'X-AgncyPay-Event-ID',
    required: true,
    description: 'Stable provider event ID for replay protection',
  })
  @Post('webhook')
  async handleWebhook(
    @Headers('x-agncypay-crm-key') apiKey: string,
    @Headers('x-agncypay-event-id') headerEventId: string | undefined,
    @Body() payload: CrmWebhookDto,
  ) {
    return this.crmService.handleWebhook(
      apiKey,
      headerEventId || payload.eventId || '',
      payload,
    );
  }

  @ApiOperation({
    summary: 'Get Agency CRM webhook configuration, endpoint URL, and API key',
  })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, AuthorizationGuard)
  @AccountTypes('agency')
  @Permissions('manage_team')
  @Get('config')
  async getCrmConfig(@CurrentUser('id') agencyId: string) {
    return this.crmService.getCrmConfig(agencyId);
  }

  @ApiOperation({
    summary: 'Create an organization-scoped CRM webhook connection',
  })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, AuthorizationGuard)
  @AccountTypes('agency')
  @Permissions('manage_team')
  @Post('config')
  async createCrmConfig(
    @CurrentUser('id') agencyId: string,
    @Body('displayName') displayName?: string,
  ) {
    return this.crmService.createCrmConfig(agencyId, displayName);
  }

  @ApiOperation({ summary: 'Rotate a CRM webhook connection secret' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, AuthorizationGuard)
  @AccountTypes('agency')
  @Permissions('manage_team')
  @Post('config/:connectionId/rotate-secret')
  async rotateCrmSecret(
    @CurrentUser('id') agencyId: string,
    @Param('connectionId') connectionId: string,
  ) {
    return this.crmService.rotateCrmSecret(agencyId, connectionId);
  }

  @ApiOperation({ summary: 'Bulk import Talent roster parsed from CSV export' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, AuthorizationGuard)
  @AccountTypes('agency')
  @Permissions('manage_team')
  @Post('import-roster')
  async importRoster(
    @CurrentUser('id') agencyId: string,
    @Body() dto: CsvRosterImportDto,
  ) {
    return this.crmService.importCsvRoster(agencyId, dto);
  }

  @ApiOperation({
    summary:
      'Get all pending payables ingested from CRM awaiting batch review & approval',
  })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, AuthorizationGuard)
  @AccountTypes('agency')
  @Permissions('approve_payouts')
  @Get('payables/pending')
  async getPendingPayables(@CurrentUser('id') agencyId: string) {
    return this.crmService.getPendingPayables(agencyId);
  }
}

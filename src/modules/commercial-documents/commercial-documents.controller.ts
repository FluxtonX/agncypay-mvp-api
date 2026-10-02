import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AuthorizationGuard } from '../../auth/guards/authorization.guard';
import {
  AccountTypes,
  OrganizationRoles,
} from '../../auth/decorators/authorization.decorator';
import { CurrentUser } from '../../common/decorators';
import { CommercialDocumentsService } from './commercial-documents.service';
import { TalentFundingService } from './talent-funding.service';

class CommercialDecisionDto {
  @IsEnum(['approved', 'rejected'])
  decision!: 'approved' | 'rejected';

  @IsOptional()
  @IsString()
  reason?: string;
}

@ApiTags('Commercial Documents')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AuthorizationGuard)
@Controller('commercial-documents')
export class CommercialDocumentsController {
  constructor(
    private readonly documents: CommercialDocumentsService,
    private readonly talentFunding: TalentFundingService,
  ) {}

  @ApiOperation({
    summary: 'List CRM/accounting commercial documents and validation state',
  })
  @AccountTypes('agency')
  @Get()
  list(@CurrentUser('id') userId: string) {
    return this.documents.listForAgency(userId);
  }

  @ApiOperation({
    summary: 'List CRM invoices payable by the authenticated Brand',
  })
  @AccountTypes('brand')
  @Get('brand')
  listForBrand(@CurrentUser('id') userId: string) {
    return this.documents.listForBrand(userId);
  }

  @ApiOperation({
    summary: 'Approve or reject a validated immutable document version',
  })
  @OrganizationRoles('agency_owner')
  @AccountTypes('agency')
  @Post('versions/:versionId/decision')
  decide(
    @CurrentUser('id') userId: string,
    @Param('versionId') versionId: string,
    @Body() dto: CommercialDecisionDto,
  ) {
    return this.documents.decide(userId, versionId, dto.decision, dto.reason);
  }

  @ApiOperation({
    summary:
      'Create exact Agency funding instructions for an approved CRM payable',
  })
  @OrganizationRoles('agency_owner')
  @AccountTypes('agency')
  @Post('versions/:versionId/talent-funding')
  prepareTalentFunding(
    @CurrentUser('id') userId: string,
    @Param('versionId') versionId: string,
  ) {
    return this.talentFunding.prepareApprovedPayable(userId, versionId);
  }
}

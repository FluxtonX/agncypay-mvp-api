import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { TalentService } from './talent.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators';

@ApiTags('Talent Management')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('talents')
export class TalentController {
  constructor(private readonly talentService: TalentService) {}

  @ApiOperation({ summary: 'Register a new Talent and create customer-owned Cybrid Counterparty' })
  @Post()
  async createTalent(
    @CurrentUser('id') agencyId: string,
    @Body('fullName') fullName: string,
    @Body('email') email?: string,
    @Body('phone') phone?: string,
    @Body('country') country?: string,
    @Body('isInternational') isInternational?: boolean,
    @Body('metadata') metadata?: Record<string, any>,
  ) {
    return this.talentService.createTalent({
      agencyId,
      fullName,
      email,
      phone,
      country,
      isInternational,
      metadata,
    });
  }

  @ApiOperation({ summary: 'Get all Talents for the current Agency' })
  @Get()
  async getTalents(@CurrentUser('id') agencyId: string) {
    return this.talentService.getTalents(agencyId);
  }

  @ApiOperation({ summary: 'Get a specific Talent by ID' })
  @Get(':id')
  async getTalentById(
    @Param('id') id: string,
    @CurrentUser('id') agencyId: string,
  ) {
    return this.talentService.getTalentById(id, agencyId);
  }

  @ApiOperation({ summary: 'Update Talent profile' })
  @Put(':id')
  async updateTalent(
    @Param('id') id: string,
    @CurrentUser('id') agencyId: string,
    @Body() data: any,
  ) {
    return this.talentService.updateTalent(id, agencyId, data);
  }

  @ApiOperation({ summary: 'Soft-delete a Talent' })
  @Delete(':id')
  async deleteTalent(
    @Param('id') id: string,
    @CurrentUser('id') agencyId: string,
  ) {
    return this.talentService.deleteTalent(id, agencyId);
  }
}

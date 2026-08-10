import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { FeatureFlagsService } from './feature-flags.service';

@ApiTags('Feature Flags')
@Controller('feature-flags')
export class FeatureFlagsController {
  constructor(private readonly featureFlagsService: FeatureFlagsService) {}

  @ApiOperation({ summary: 'Get all feature flags status' })
  @Get()
  async getFlags() {
    return this.featureFlagsService.getAllFlags();
  }

  @ApiOperation({ summary: 'Set or update a feature flag' })
  @Post()
  async setFlag(@Body() body: { key: string; enabled: boolean; description?: string }) {
    return this.featureFlagsService.setFlag(body.key, body.enabled, body.description);
  }
}

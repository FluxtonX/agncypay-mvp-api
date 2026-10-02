import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { HealthService } from './health.service';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get('live')
  @ApiOperation({ summary: 'Process liveness without dependency checks' })
  live() {
    return this.healthService.liveness();
  }

  @Get('ready')
  @ApiOperation({ summary: 'Database and required-configuration readiness' })
  ready() {
    return this.healthService.readiness();
  }
}

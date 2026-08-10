import { Module, Global } from '@nestjs/common';
import { FeatureFlagsService } from './feature-flags.service';
import { FeatureFlagsController } from './feature-flags.controller';
import { FeatureFlagRepository } from '../../infrastructure/database/repositories/feature-flag.repository';
import { PrismaModule } from '../../prisma/prisma.module';

@Global()
@Module({
  imports: [PrismaModule],
  controllers: [FeatureFlagsController],
  providers: [FeatureFlagsService, FeatureFlagRepository],
  exports: [FeatureFlagsService],
})
export class FeatureFlagsModule {}

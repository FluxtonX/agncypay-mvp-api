import { Injectable } from '@nestjs/common';
import { FeatureFlagRepository } from '../../infrastructure/database/repositories/feature-flag.repository';
import { FeatureFlag } from '@prisma/client';

@Injectable()
export class FeatureFlagsService {
  constructor(private readonly featureFlagRepo: FeatureFlagRepository) {}

  async isEnabled(key: string): Promise<boolean> {
    const flag = await this.featureFlagRepo.findByKey(key);
    if (!flag) return true; // Default to true if not specified
    return flag.enabled;
  }

  async getAllFlags(): Promise<Record<string, boolean>> {
    const flags = await this.featureFlagRepo.findAll();
    const result: Record<string, boolean> = {};
    for (const flag of flags) {
      result[flag.key] = flag.enabled;
    }
    return result;
  }

  async setFlag(key: string, enabled: boolean, description?: string): Promise<FeatureFlag> {
    return this.featureFlagRepo.upsert(key, enabled, description);
  }
}

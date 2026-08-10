import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { FeatureFlag, Prisma } from '@prisma/client';

@Injectable()
export class FeatureFlagRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByKey(key: string): Promise<FeatureFlag | null> {
    return this.prisma.featureFlag.findUnique({
      where: { key },
    });
  }

  async findAll(): Promise<FeatureFlag[]> {
    return this.prisma.featureFlag.findMany({
      orderBy: { key: 'asc' },
    });
  }

  async upsert(key: string, enabled: boolean, description?: string): Promise<FeatureFlag> {
    return this.prisma.featureFlag.upsert({
      where: { key },
      update: { enabled, description },
      create: { key, enabled, description },
    });
  }
}

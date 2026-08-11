import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit() {
    try {
      await this.$connect();
      this.logger.log('Prisma connected to database successfully.');
    } catch (err: any) {
      this.logger.error(`Prisma failed to connect to database: ${err.message}`, err.stack);
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}


import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  liveness() {
    return { status: 'ok' as const };
  }

  async readiness() {
    const missingConfiguration = this.missingRequiredConfiguration();
    if (missingConfiguration.length) {
      throw new ServiceUnavailableException({
        status: 'not_ready',
        checks: { configuration: 'failed', database: 'not_checked' },
      });
    }

    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException({
        status: 'not_ready',
        checks: { configuration: 'ok', database: 'failed' },
      });
    }

    return {
      status: 'ready' as const,
      checks: { configuration: 'ok', database: 'ok' },
    };
  }

  private missingRequiredConfiguration(): string[] {
    const required = ['JWT_SECRET', 'JWT_REFRESH_SECRET'];
    const hasDatabaseUrl = Boolean(this.config.get<string>('DATABASE_URL'));
    const hasDatabaseParts = [
      'DB_HOST',
      'DB_NAME',
      'DB_USER',
      'DB_PASSWORD',
    ].every((name) => Boolean(this.config.get<string>(name)));
    if (!hasDatabaseUrl && !hasDatabaseParts) required.push('DATABASE_URL');

    if (this.config.get<string>('AUTH_EMAIL_MODE') === 'ses') {
      required.push('AWS_REGION', 'AUTH_EMAIL_FROM', 'FRONTEND_URL');
    }
    return required.filter((name) => !this.config.get<string>(name));
  }
}

import { ConfigService } from '@nestjs/config';
import { ServiceUnavailableException } from '@nestjs/common';
import { HealthService } from './health.service';

describe('HealthService', () => {
  const readyConfig = new ConfigService({
    DATABASE_URL: 'postgresql://test',
    JWT_SECRET: 'access-secret',
    JWT_REFRESH_SECRET: 'refresh-secret',
    AUTH_EMAIL_MODE: 'capture',
  });

  it('reports liveness without touching dependencies', () => {
    const query = jest.fn();
    const service = new HealthService(
      { $queryRaw: query } as never,
      readyConfig,
    );
    expect(service.liveness()).toEqual({ status: 'ok' });
    expect(query).not.toHaveBeenCalled();
  });

  it('reports readiness after a database probe', async () => {
    const service = new HealthService(
      { $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]) } as never,
      readyConfig,
    );
    await expect(service.readiness()).resolves.toEqual({
      status: 'ready',
      checks: { configuration: 'ok', database: 'ok' },
    });
  });

  it('fails readiness without exposing database errors', async () => {
    const service = new HealthService(
      {
        $queryRaw: jest.fn().mockRejectedValue(new Error('secret DSN')),
      } as never,
      readyConfig,
    );
    await expect(service.readiness()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});

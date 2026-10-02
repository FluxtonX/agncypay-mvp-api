import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

describe('AgncyPay runtime surface (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('boots the versioned API', () => {
    return request(app.getHttpServer())
      .get('/api/v1')
      .expect(200)
      .expect('Hello World!');
  });

  it('exposes liveness and database readiness separately', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/health/live')
      .expect(200)
      .expect({ status: 'ok' });
    await request(app.getHttpServer())
      .get('/api/v1/health/ready')
      .expect(200)
      .expect({
        status: 'ready',
        checks: { configuration: 'ok', database: 'ok' },
      });
  });

  it.each([
    ['post', '/api/v1/auth/register'],
    ['get', '/api/v1/wallets/me'],
    ['post', '/api/v1/payouts/request'],
    ['get', '/api/v1/treasury/balance'],
    ['get', '/api/v1/invoices'],
    ['get', '/api/v1/transactions'],
    ['get', '/api/v1/workspaces'],
    ['get', '/api/v1/talents'],
    ['post', '/api/v1/verification/plaid/processor-token'],
    ['post', '/api/v1/verification/conduit/submit-onboarding'],
  ])('does not mount retired %s %s', async (method, path) => {
    const client = request(app.getHttpServer());
    if (method === 'post') {
      await client.post(path).expect(404);
      return;
    }
    await client.get(path).expect(404);
  });

  it('protects the canonical Talent balance route', () => {
    return request(app.getHttpServer())
      .get('/api/v1/talent-balance')
      .expect(401);
  });

  it('validates refresh-token input before authentication work', () => {
    return request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: 'not-a-jwt' })
      .expect(400);
  });
});

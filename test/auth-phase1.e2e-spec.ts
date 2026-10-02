import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Phase 1 identity and access (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const agencyAEmail = `phase1-agency-a-${suffix}@example.test`;
  const agencyBEmail = `phase1-agency-b-${suffix}@example.test`;
  const talentEmail = `phase1-talent-${suffix}@example.test`;
  const password = 'Phase1-Test-Password!';
  const captureKey = `capture-${suffix}`;
  const createdUserIds: string[] = [];
  const createdParticipantIds: string[] = [];
  const createdOrganizationIds: string[] = [];

  beforeAll(async () => {
    process.env.AUTH_EMAIL_CAPTURE_KEY = captureKey;
    process.env.NODE_ENV = 'test';
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
    prisma = moduleFixture.get(PrismaService);
  });

  afterAll(async () => {
    if (createdOrganizationIds.length) {
      await prisma.organizationRelationship.deleteMany({
        where: {
          OR: [
            { sourceOrganizationId: { in: createdOrganizationIds } },
            { targetOrganizationId: { in: createdOrganizationIds } },
          ],
        },
      });
      await prisma.invitation.deleteMany({
        where: { organizationId: { in: createdOrganizationIds } },
      });
    }
    if (createdUserIds.length || createdOrganizationIds.length) {
      await prisma.auditLog.deleteMany({
        where: {
          OR: [
            { userId: { in: createdUserIds } },
            { organizationId: { in: createdOrganizationIds } },
          ],
        },
      });
    }
    if (createdOrganizationIds.length) {
      await prisma.organization.deleteMany({
        where: { id: { in: createdOrganizationIds } },
      });
    }
    if (createdUserIds.length) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    if (createdParticipantIds.length) {
      await prisma.participant.deleteMany({
        where: { id: { in: createdParticipantIds } },
      });
    }
    await app.close();
  });

  async function capturedToken(deliveryId: string): Promise<string> {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/auth/development/emails/${deliveryId}`)
      .set('x-dev-email-key', captureKey)
      .expect(200);
    return response.body.token;
  }

  async function signupAndVerify(params: {
    email: string;
    accountType: 'agency' | 'brand' | 'talent';
    fullName: string;
    organizationName?: string;
  }) {
    const signup = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({ ...params, password })
      .expect(201);
    createdUserIds.push(signup.body.userId);

    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: params.email, password })
      .expect(403);

    const token = await capturedToken(signup.body.emailDelivery.id);
    const verified = await request(app.getHttpServer())
      .post('/api/v1/auth/verify-email')
      .send({ token })
      .expect(201);
    const profile = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${verified.body.accessToken}`)
      .expect(200);
    const storedRefresh = await prisma.refreshToken.findFirstOrThrow({
      where: { userId: signup.body.userId },
    });
    expect(storedRefresh.tokenHash).not.toBe(verified.body.refreshToken);
    const links = await prisma.participantUser.findMany({
      where: { userId: signup.body.userId },
      include: {
        participant: {
          include: {
            organizations: true,
          },
        },
      },
    });
    for (const link of links) {
      createdParticipantIds.push(link.participantId);
      createdOrganizationIds.push(
        ...link.participant.organizations.map((item) => item.organizationId),
      );
    }
    return {
      accessToken: verified.body.accessToken as string,
      refreshToken: verified.body.refreshToken as string,
      profile: profile.body,
    };
  }

  it('supports public signup, tenant isolation, invitations, and multi-organization personas', async () => {
    const agencyA = await signupAndVerify({
      email: agencyAEmail,
      accountType: 'agency',
      fullName: 'Agency A Owner',
      organizationName: `Phase 1 Agency A ${suffix}`,
    });
    const agencyB = await signupAndVerify({
      email: agencyBEmail,
      accountType: 'agency',
      fullName: 'Agency B Owner',
      organizationName: `Phase 1 Agency B ${suffix}`,
    });
    const talent = await signupAndVerify({
      email: talentEmail,
      accountType: 'talent',
      fullName: 'Phase 1 Talent',
    });

    expect(agencyA.profile.memberships[0].metadata.organizationRole).toBe(
      'agency_owner',
    );
    expect(talent.profile.accountType).toBe('talent');

    const agencyAOrganizationId = agencyA.profile.memberships[0].organizationId;
    const agencyBOrganizationId = agencyB.profile.memberships[0].organizationId;

    await request(app.getHttpServer())
      .post('/api/v1/auth/invitations')
      .set('Authorization', `Bearer ${agencyA.accessToken}`)
      .send({
        organizationId: agencyBOrganizationId,
        email: `blocked-${suffix}@example.test`,
        accountType: 'talent',
      })
      .expect(403);

    const invitation = await request(app.getHttpServer())
      .post('/api/v1/auth/invitations')
      .set('Authorization', `Bearer ${agencyA.accessToken}`)
      .send({
        organizationId: agencyAOrganizationId,
        email: agencyBEmail,
        accountType: 'brand',
        organizationRole: 'brand_admin',
        organizationName: `Phase 1 Brand ${suffix}`,
      })
      .expect(201);
    expect(invitation.body.token).toBeUndefined();
    const invitationToken = await capturedToken(
      invitation.body.emailDelivery.id,
    );

    await request(app.getHttpServer())
      .post('/api/v1/auth/invitations/accept')
      .send({ token: invitationToken })
      .expect(401);

    await request(app.getHttpServer())
      .post('/api/v1/auth/invitations/accept')
      .set('Authorization', `Bearer ${agencyB.accessToken}`)
      .send({ token: invitationToken })
      .expect(201);

    const multiPersona = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${agencyB.accessToken}`)
      .expect(200);
    const organizationTypes = multiPersona.body.memberships.map(
      (membership: { organizationType: string }) => membership.organizationType,
    );
    expect(organizationTypes).toEqual(
      expect.arrayContaining(['agency', 'brand']),
    );

    const brandOrganization = multiPersona.body.memberships.find(
      (membership: { organizationType: string }) =>
        membership.organizationType === 'brand',
    );
    createdOrganizationIds.push(brandOrganization.organizationId);

    const rotated = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: agencyA.refreshToken })
      .expect(200);
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: agencyA.refreshToken })
      .expect(401);
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: rotated.body.refreshToken })
      .expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${agencyA.accessToken}`)
      .expect(401);

    await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${talent.accessToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${talent.accessToken}`)
      .expect(401);
  });
});

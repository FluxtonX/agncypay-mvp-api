import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';

const prisma = new PrismaClient();

async function main() {
  const flags = [
    {
      key: 'wire_enabled',
      enabled: false,
      description: 'Wire transfer payment option',
    },
    {
      key: 'rtp_enabled',
      enabled: false,
      description: 'Real-time payment option',
    },
    {
      key: 'ach_enabled',
      enabled: true,
      description: 'ACH payment processing',
    },
    {
      key: 'plaid_enabled',
      enabled: true,
      description: 'Plaid bank account verification',
    },
    {
      key: 'qbo_sync_enabled',
      enabled: true,
      description: 'QuickBooks Online source synchronization',
    },
  ];

  for (const flag of flags) {
    await prisma.featureFlag.upsert({
      where: { key: flag.key },
      update: { enabled: flag.enabled, description: flag.description },
      create: flag,
    });
  }

  const platformEmail = process.env.PLATFORM_ADMIN_EMAIL?.trim().toLowerCase();
  const platformPassword = process.env.PLATFORM_ADMIN_PASSWORD;
  if (platformEmail || platformPassword) {
    if (!platformEmail || !platformPassword || platformPassword.length < 12) {
      throw new Error(
        'PLATFORM_ADMIN_EMAIL and a 12+ character PLATFORM_ADMIN_PASSWORD are both required',
      );
    }
    const platformName =
      process.env.PLATFORM_ADMIN_NAME?.trim() || 'AgncyPay Platform Admin';
    const passwordHash = await bcrypt.hash(platformPassword, 12);

    await prisma.$transaction(async (tx) => {
      const organization =
        (await tx.organization.findFirst({
          where: { type: 'platform', deletedAt: null },
        })) ??
        (await tx.organization.create({
          data: { type: 'platform', name: 'AgncyPay Platform' },
        }));
      const user = await tx.user.upsert({
        where: { email: platformEmail },
        update: {
          password: passwordHash,
          fullName: platformName,
          accountType: 'platform',
          emailVerified: true,
          deletedAt: null,
        },
        create: {
          email: platformEmail,
          password: passwordHash,
          fullName: platformName,
          accountType: 'platform',
          agncyId: `PLT-${crypto.randomUUID()}`,
          emailVerified: true,
        },
      });
      const link = await tx.participantUser.findUnique({
        where: { userId: user.id },
      });
      const participant = link
        ? await tx.participant.update({
            where: { id: link.participantId },
            data: {
              displayName: platformName,
              status: 'active',
              deletedAt: null,
            },
          })
        : await tx.participant.create({
            data: { displayName: platformName },
          });
      await tx.participantUser.upsert({
        where: { userId: user.id },
        update: { participantId: participant.id, isPrimary: true },
        create: {
          userId: user.id,
          participantId: participant.id,
          isPrimary: true,
        },
      });
      await tx.organizationParticipant.upsert({
        where: {
          organizationId_participantId_relationshipType: {
            organizationId: organization.id,
            participantId: participant.id,
            relationshipType: 'platform_admin',
          },
        },
        update: {
          status: 'active',
          endsAt: null,
          metadata: {
            organizationRole: 'platform_admin',
            permissions: [
              'platform_admin',
              'manage_team',
              'manage_integrations',
              'view_reports',
              'approve_payouts',
              'initiate_payments',
            ],
          },
        },
        create: {
          organizationId: organization.id,
          participantId: participant.id,
          relationshipType: 'platform_admin',
          metadata: {
            organizationRole: 'platform_admin',
            permissions: [
              'platform_admin',
              'manage_team',
              'manage_integrations',
              'view_reports',
              'approve_payouts',
              'initiate_payments',
            ],
          },
        },
      });
    });
  }
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

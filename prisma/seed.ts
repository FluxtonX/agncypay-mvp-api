import { PrismaClient } from '@prisma/client';

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
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

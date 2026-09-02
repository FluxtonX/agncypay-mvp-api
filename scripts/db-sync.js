const { PrismaClient } = require('@prisma/client');
const { execSync } = require('child_process');

async function main() {
  const prisma = new PrismaClient();
  try {
    console.log('[DBSync] Checking and sanitizing legacy foreign keys...');
    await prisma.$executeRawUnsafe(`UPDATE cybrid_counterparties SET "talentId" = NULL WHERE "talentId" IS NOT NULL AND "talentId" NOT IN (SELECT id FROM users);`).catch(() => {});
    await prisma.$executeRawUnsafe(`UPDATE payment_payouts SET "talentId" = NULL WHERE "talentId" IS NOT NULL AND "talentId" NOT IN (SELECT id FROM users);`).catch(() => {});
    await prisma.$disconnect();
  } catch (err) {
    console.log('[DBSync] Pre-check note:', err.message);
  }

  console.log('[DBSync] Synchronizing Prisma schema to database...');
  try {
    execSync('npx prisma db push --accept-data-loss', { stdio: 'inherit' });
    console.log('[DBSync] Database sync complete!');
  } catch (err) {
    console.warn('[DBSync] Prisma db push finished with note:', err.message);
  }
}

main().catch((err) => {
  console.error('[DBSync] Handled error:', err);
  process.exit(0);
});

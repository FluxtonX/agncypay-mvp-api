import { PrismaClient } from "@prisma/client";
import * as bcrypt from "bcrypt";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding database...");

  const hashedPassword = await bcrypt.hash("Password123!", 12);

  // 1. Create Demo Brand User
  const brandUser = await prisma.user.upsert({
    where: { email: "brand@nike.com" },
    update: {},
    create: {
      email: "brand@nike.com",
      password: hashedPassword,
      fullName: "Nike Finance Manager",
      accountType: "brand",
      agncyId: "MB-USER-BRAND-001",
    },
  });

  // 2. Create Demo Brand Workspace
  const brandWorkspace = await prisma.workspace.upsert({
    where: { agncyId: "MB-BRAND-001" },
    update: {},
    create: {
      type: "brand",
      name: "Nike Studios",
      agncyId: "MB-BRAND-001",
      verificationTrack: "kyb",
      verificationStatus: "approved",
      ownerId: brandUser.id,
      memberships: {
        create: {
          userId: brandUser.id,
          role: "admin",
          permissions: ["approve_invoices", "initiate_payments", "view_treasury", "manage_team", "view_reports"],
          status: "active",
        },
      },
    },
  });

  // 3. Create Demo Agency User
  const agencyUser = await prisma.user.upsert({
    where: { email: "agency@elite.com" },
    update: {},
    create: {
      email: "agency@elite.com",
      password: hashedPassword,
      fullName: "Elite Talent Agency",
      accountType: "agency",
      agncyId: "MB-USER-AGENCY-001",
    },
  });

  // 4. Create Demo Agency Workspace
  const agencyWorkspace = await prisma.workspace.upsert({
    where: { agncyId: "MB-AGENCY-001" },
    update: {},
    create: {
      type: "agency",
      name: "Elite Talent Agency",
      agncyId: "MB-AGENCY-001",
      verificationTrack: "kyb",
      verificationStatus: "approved",
      ownerId: agencyUser.id,
      memberships: {
        create: {
          userId: agencyUser.id,
          role: "agency_admin",
          permissions: ["create_invoices", "approve_payouts", "manage_team", "view_reports"],
          status: "active",
        },
      },
    },
  });

  // 1b. Provision Brand Wallet
  const brandWallet = await prisma.wallet.upsert({
    where: { userId: brandUser.id },
    update: {},
    create: {
      walletId: "WAL-BRND-901824",
      userId: brandUser.id,
      accountType: "brand",
      balance: 25000,
      status: "active",
    },
  });

  // 3b. Provision Agency Wallet
  const agencyWallet = await prisma.wallet.upsert({
    where: { userId: agencyUser.id },
    update: {},
    create: {
      walletId: "WAL-AGY-104928",
      userId: agencyUser.id,
      accountType: "agency",
      balance: 14500,
      status: "active",
    },
  });

  // 5. Create Demo Invoices
  await prisma.invoice.upsert({
    where: { invoiceNumber: "W-INV-9021" },
    update: {
      agencyWalletId: agencyWallet.id,
      brandWalletId: brandWallet.id,
    },
    create: {
      id: "W-INV-9021",
      invoiceNumber: "W-INV-9021",
      campaign: "Summer Air Max Global Launch",
      agencyId: agencyUser.id,
      agencyEmail: agencyUser.email,
      agencyWalletId: agencyWallet.id,
      brandId: brandUser.id,
      brandName: brandWorkspace.name,
      brandEmail: brandUser.email,
      brandWalletId: brandWallet.id,
      amount: 45000,
      due: "15/08/2026",
      status: "pending",
      payoutStatus: "pending",
      createdDate: "01/08/2026",
      payerId: "MB-6984",
      payerEmail: "billing@nike.com",
      payerAddress: ["One Bowerman Drive", "Beaverton, OR 97005"],
      splits: [
        { talentName: "Alex Rivera", talentEmail: "alex@rivera.com", percentage: 70, amount: 31500, status: "pending" },
        { talentName: "Elite Commission", talentEmail: "agency@elite.com", percentage: 30, amount: 13500, status: "pending" },
      ],
    },
  });

  await prisma.invoice.upsert({
    where: { invoiceNumber: "W-INV-8842" },
    update: {
      agencyWalletId: agencyWallet.id,
      brandWalletId: brandWallet.id,
    },
    create: {
      id: "W-INV-8842",
      invoiceNumber: "W-INV-8842",
      campaign: "Fall Athletics Runway Campaign",
      agencyId: agencyUser.id,
      agencyEmail: agencyUser.email,
      agencyWalletId: agencyWallet.id,
      brandId: brandUser.id,
      brandName: brandWorkspace.name,
      brandEmail: brandUser.email,
      brandWalletId: brandWallet.id,
      amount: 28500,
      due: "28/08/2026",
      status: "paid",
      payoutStatus: "pending",
      createdDate: "20/07/2026",
      payerId: "MB-6984",
      payerEmail: "billing@nike.com",
      payerAddress: ["One Bowerman Drive", "Beaverton, OR 97005"],
      splits: [
        { talentName: "Jordan Hayes", talentEmail: "jordan@hayes.com", percentage: 80, amount: 22800, status: "pending" },
        { talentName: "Elite Commission", talentEmail: "agency@elite.com", percentage: 20, amount: 5700, status: "pending" },
      ],
    },
  });


  console.log("Database seeded successfully.");

  // 6. Seed Feature Flags
  const flags = [
    { key: "wire_enabled", enabled: false, description: "Wire transfer payment option (disabled for MVP)" },
    { key: "rtp_enabled", enabled: false, description: "Real-Time Payment option (disabled for MVP)" },
    { key: "ach_enabled", enabled: true, description: "ACH payment processing" },
    { key: "plaid_enabled", enabled: true, description: "Plaid bank account verification" },
    { key: "qbo_sync_enabled", enabled: true, description: "QuickBooks Online read-only invoice sync" },
  ];

  for (const flag of flags) {
    await prisma.featureFlag.upsert({
      where: { key: flag.key },
      update: { enabled: flag.enabled, description: flag.description },
      create: flag,
    });
  }
  console.log("Feature flags seeded successfully.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env') });

const prisma = new PrismaClient();

async function sync() {
  console.log('=== SYNCING LIVE CYBRID ENTITIES INTO AGNCYPAY DATABASE ===');

  const agencyId = '7259bcba-acdf-4fe8-a61a-d2529182bc6c';
  const customerGuid = '13d6e7a756d7014144b23056ce796f17';
  const usdAccountGuid = '9cecb8cf97fa9c503c7c666faec64499';
  const usdcAccountGuid = 'b825484b91a501415ed7c50477bfb554';
  const dbaGuid = '892e66438408903831039abd15eb117e';
  const dbaMemo = 'SFC3G0AHBW';

  const cpDomGuid = '8d819f2a6b5cf9186d2cd261c385ab6f';
  const ebaDomGuid = 'ad2a38e9a636bc7af30f176a2de898a5';

  const cpIntlGuid = '006eba2b62637d5ad86e41cd44d6f3e8';
  const ebaIntlGuid = '010d2fb84708fd54546bf7f294b47196';

  // 1. Ensure CybridCustomer in DB
  const cybCust = await prisma.cybridCustomer.upsert({
    where: { userId: agencyId },
    update: {
      cybridCustomerGuid: customerGuid,
      customerType: 'business',
      kybStatus: 'approved',
      kybOutcome: 'passed',
    },
    create: {
      userId: agencyId,
      cybridCustomerGuid: customerGuid,
      customerType: 'business',
      kybStatus: 'approved',
      kybOutcome: 'passed',
    },
  });
  console.log('✅ CybridCustomer DB record updated:', cybCust.id);

  // 2. Ensure USD Fiat Account
  const fiatAcc = await prisma.cybridAccount.upsert({
    where: { cybridAccountGuid: usdAccountGuid },
    update: {
      cybridCustomerId: cybCust.id,
      accountType: 'fiat',
      asset: 'USD',
      status: 'created',
    },
    create: {
      cybridCustomerId: cybCust.id,
      cybridAccountGuid: usdAccountGuid,
      accountType: 'fiat',
      asset: 'USD',
      status: 'created',
    },
  });
  console.log('✅ USD CybridAccount DB record updated:', fiatAcc.id);

  // 3. Ensure USDC Trading Account
  const tradeAcc = await prisma.cybridAccount.upsert({
    where: { cybridAccountGuid: usdcAccountGuid },
    update: {
      cybridCustomerId: cybCust.id,
      accountType: 'trading',
      asset: 'USDC',
      status: 'created',
    },
    create: {
      cybridCustomerId: cybCust.id,
      cybridAccountGuid: usdcAccountGuid,
      accountType: 'trading',
      asset: 'USDC',
      status: 'created',
    },
  });
  console.log('✅ USDC CybridAccount DB record updated:', tradeAcc.id);

  // 4. Ensure Deposit Bank Account in DB
  const dba = await prisma.cybridDepositBankAccount.upsert({
    where: { cybridDepositBankGuid: dbaGuid },
    update: {
      cybridAccountId: fiatAcc.id,
      routingNumber: '111000025',
      routingNumberType: 'cpa',
      accountNumber: '8800' + usdAccountGuid.slice(0, 6),
      uniqueMemoId: dbaMemo,
      bankName: 'Cybrid Sandbox Settlement Bank',
      status: 'created',
    },
    create: {
      cybridAccountId: fiatAcc.id,
      cybridDepositBankGuid: dbaGuid,
      routingNumber: '111000025',
      routingNumberType: 'cpa',
      accountNumber: '8800' + usdAccountGuid.slice(0, 6),
      uniqueMemoId: dbaMemo,
      bankName: 'Cybrid Sandbox Settlement Bank',
      status: 'created',
    },
  });
  console.log('✅ CybridDepositBankAccount DB record updated:', dba.id);

  // 5. Ensure Domestic Talent & Counterparty & External Bank Account
  const talentDom = await prisma.talent.findFirst({
    where: { agencyId, fullName: 'Emma Stone' },
  });
  if (talentDom) {
    const cp = await prisma.cybridCounterparty.upsert({
      where: { cybridCounterpartyGuid: cpDomGuid },
      update: {
        cybridCustomerId: cybCust.id,
        talentId: talentDom.id,
        name: 'Emma Stone',
        status: 'verified',
      },
      create: {
        cybridCustomerId: cybCust.id,
        cybridCounterpartyGuid: cpDomGuid,
        talentId: talentDom.id,
        name: 'Emma Stone',
        status: 'verified',
      },
    });

    const eba = await prisma.cybridExternalBankAccount.upsert({
      where: { cybridExternalBankGuid: ebaDomGuid },
      update: {
        cybridCounterpartyId: cp.id,
        asset: 'USD',
        accountKind: 'raw_routing_details',
        bankName: 'Emma Stone Checking',
        mask: '6789',
        status: 'completed',
      },
      create: {
        cybridExternalBankGuid: ebaDomGuid,
        cybridCounterpartyId: cp.id,
        asset: 'USD',
        accountKind: 'raw_routing_details',
        bankName: 'Emma Stone Checking',
        mask: '6789',
        status: 'completed',
      },
    });
    console.log('✅ Domestic Talent Counterparty & External Bank synced:', cp.id, eba.id);
  }

  // 6. Ensure International Talent & Counterparty & External Bank Account
  const talentIntl = await prisma.talent.findFirst({
    where: { agencyId, fullName: 'Lucas Silva' },
  });
  if (talentIntl) {
    const cp = await prisma.cybridCounterparty.upsert({
      where: { cybridCounterpartyGuid: cpIntlGuid },
      update: {
        cybridCustomerId: cybCust.id,
        talentId: talentIntl.id,
        name: 'Lucas Silva',
        status: 'verified',
      },
      create: {
        cybridCustomerId: cybCust.id,
        cybridCounterpartyGuid: cpIntlGuid,
        talentId: talentIntl.id,
        name: 'Lucas Silva',
        status: 'verified',
      },
    });

    const eba = await prisma.cybridExternalBankAccount.upsert({
      where: { cybridExternalBankGuid: ebaIntlGuid },
      update: {
        cybridCounterpartyId: cp.id,
        asset: 'USD',
        accountKind: 'raw_routing_details',
        bankName: 'Lucas Silva Checking',
        mask: '4321',
        status: 'completed',
      },
      create: {
        cybridExternalBankGuid: ebaIntlGuid,
        cybridCounterpartyId: cp.id,
        asset: 'USD',
        accountKind: 'raw_routing_details',
        bankName: 'Lucas Silva Checking',
        mask: '4321',
        status: 'completed',
      },
    });
    console.log('✅ International Talent Counterparty & External Bank synced:', cp.id, eba.id);
  }
}

sync()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });

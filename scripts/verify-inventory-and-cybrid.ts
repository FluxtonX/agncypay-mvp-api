import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env') });

const prisma = new PrismaClient();

async function getCybridAuthToken(): Promise<{ token: string; baseUrl: string; bankGuid: string }> {
  const clientId = process.env.CYBRID_CLIENT_ID;
  const clientSecret = process.env.CYBRID_CLIENT_SECRET;
  const idpUrl = process.env.CYBRID_IDP_URL || 'https://id.sandbox.cybrid.app';
  const baseUrl = process.env.CYBRID_BASE_URL || 'https://bank.sandbox.cybrid.app';
  const bankGuid = process.env.CYBRID_BANK_GUID || '';

  if (!clientId || !clientSecret) {
    throw new Error('CYBRID_CLIENT_ID or CYBRID_CLIENT_SECRET missing in environment');
  }

  const scopes = [
    'customers:read customers:execute',
    'accounts:read accounts:execute',
    'quotes:read quotes:execute',
    'trades:read trades:execute',
    'transfers:read transfers:execute',
    'external_bank_accounts:read external_bank_accounts:execute',
    'workflows:read workflows:execute',
    'counterparties:read counterparties:execute',
    'deposit_bank_accounts:read deposit_bank_accounts:execute',
    'identity_verifications:read identity_verifications:execute',
    'prices:read',
    'banks:read',
  ].join(' ');

  const res = await axios.post(
    `${idpUrl}/oauth/token`,
    {
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      scope: scopes,
    },
    { headers: { 'Content-Type': 'application/json' } }
  );

  return { token: res.data.access_token, baseUrl, bankGuid };
}

async function run() {
  console.log('================================================================');
  console.log('       AGNCYPAY REAL CYBRID SANDBOX E2E - INVENTORY & CHECK     ');
  console.log('================================================================\n');

  console.log('--- 1. ENVIRONMENT VERIFICATION ---');
  console.log('Environment: CYBRID SANDBOX');
  console.log('CYBRID_BASE_URL:', process.env.CYBRID_BASE_URL);
  console.log('CYBRID_IDP_URL:', process.env.CYBRID_IDP_URL);
  console.log('CYBRID_BANK_GUID configured:', !!process.env.CYBRID_BANK_GUID);
  console.log('CYBRID_CLIENT_ID configured:', !!process.env.CYBRID_CLIENT_ID);
  console.log('CYBRID_CLIENT_SECRET configured:', !!process.env.CYBRID_CLIENT_SECRET);
  console.log('DATABASE_URL configured:', !!process.env.DATABASE_URL);

  const { token, baseUrl } = await getCybridAuthToken();
  const cybridHeaders = {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  };
  console.log('✅ Cybrid OAuth Token Acquired Successfully.');

  console.log('\n--- 2. EXISTING DATABASE ENTITIES INVENTORY ---');
  const users = await prisma.user.findMany({
    include: {
      cybridCustomer: {
        include: {
          accounts: {
            include: {
              depositBankAccounts: true,
            },
          },
          counterparties: {
            include: {
              externalBankAccounts: true,
            },
          },
        },
      },
      talentsManaged: {
        include: {
          counterparties: {
            include: {
              externalBankAccounts: true,
            },
          },
        },
      },
      bankDetails: true,
      wallet: true,
      treasury: true,
    },
  });

  console.log(`Found ${users.length} total Users in Database.`);

  const agencyList: any[] = [];
  const brandList: any[] = [];

  for (const u of users) {
    if (u.accountType === 'agency' || (u.cybridCustomer && u.cybridCustomer.customerType === 'business')) {
      agencyList.push(u);
    } else if (u.accountType === 'brand') {
      brandList.push(u);
    }
  }

  console.log(`- Agencies / Business Accounts: ${agencyList.length}`);
  console.log(`- Brands: ${brandList.length}`);

  console.log('\n--- 3. DATABASE ↔ CYBRID SANDBOX CONSISTENCY VERIFICATION ---');

  for (const agency of agencyList) {
    console.log(`\n========================================================`);
    console.log(`AGENCY: "${agency.fullName}" (ID: ${agency.id}) | Email: ${agency.email}`);
    console.log(`Local KYB Status: ${agency.kybStatus}`);

    if (!agency.cybridCustomer) {
      console.log('⚠️ No Cybrid Customer record linked in database for this agency.');
      continue;
    }

    const customerGuid = agency.cybridCustomer.cybridCustomerGuid;
    console.log(`Checking Cybrid Customer GUID: ${customerGuid}...`);

    try {
      const custRes = await axios.get(`${baseUrl}/api/customers/${customerGuid}`, cybridHeaders);
      const cybCust = custRes.data;
      console.log(`  ✅ Cybrid Customer Confirmed! Type: ${cybCust.type} | State: ${cybCust.state} | Created: ${cybCust.created_at}`);

      // Check Accounts
      console.log(`Checking Cybrid Accounts for customer ${customerGuid}...`);
      const accRes = await axios.get(`${baseUrl}/api/accounts?customer_guid=${customerGuid}`, cybridHeaders);
      const cybAccounts = accRes.data.objects || [];
      console.log(`  ✅ Found ${cybAccounts.length} live accounts in Cybrid:`);
      for (const acc of cybAccounts) {
        console.log(`    - GUID: ${acc.guid} | Type: ${acc.type} | Asset: ${acc.asset} | State: ${acc.state} | Platform Bal: ${acc.platform_balance} | Platform Avail: ${acc.platform_available}`);
      }

      // Check Deposit Bank Accounts
      for (const dbAcc of agency.cybridCustomer.accounts) {
        for (const dba of dbAcc.depositBankAccounts) {
          console.log(`Checking Deposit Bank Account in Cybrid: ${dba.cybridDepositBankGuid}...`);
          try {
            const dbaRes = await axios.get(`${baseUrl}/api/deposit_bank_accounts/${dba.cybridDepositBankGuid}`, cybridHeaders);
            const cybDba = dbaRes.data;
            console.log(`    ✅ Confirmed Deposit Bank Account in Cybrid!`);
            console.log(`       Routing: ${cybDba.routing_number} | Account: ${cybDba.account_number} | Bank: ${cybDba.bank_name} | State: ${cybDba.state}`);
          } catch (e: any) {
            console.log(`    ❌ Cybrid Deposit Bank Account NOT found or error: ${e.response?.status} - ${e.message}`);
          }
        }
      }

      // Check Talents & Counterparties
      if (agency.talentsManaged && agency.talentsManaged.length > 0) {
        console.log(`Checking ${agency.talentsManaged.length} Talents for Agency...`);
        for (const talent of agency.talentsManaged) {
          console.log(`  - Talent "${talent.fullName}" (ID: ${talent.id}) | Country: ${talent.country} | Intl: ${talent.isInternational}`);
          for (const cp of talent.counterparties) {
            console.log(`    Checking Counterparty in Cybrid: ${cp.cybridCounterpartyGuid}...`);
            try {
              const cpRes = await axios.get(`${baseUrl}/api/counterparties/${cp.cybridCounterpartyGuid}`, cybridHeaders);
              const cybCp = cpRes.data;
              console.log(`      ✅ Cybrid Counterparty Confirmed! Name: ${cybCp.name?.full || cybCp.name} | Type: ${cybCp.type} | State: ${cybCp.state}`);
            } catch (e: any) {
              console.log(`      ❌ Counterparty NOT found in Cybrid: ${e.response?.status} - ${e.message}`);
            }

            for (const eba of cp.externalBankAccounts) {
              console.log(`    Checking External Bank Account in Cybrid: ${eba.cybridExternalBankGuid}...`);
              try {
                const ebaRes = await axios.get(`${baseUrl}/api/external_bank_accounts/${eba.cybridExternalBankGuid}`, cybridHeaders);
                const cybEba = ebaRes.data;
                console.log(`      ✅ Cybrid External Bank Account Confirmed! Asset: ${cybEba.asset} | Bank: ${cybEba.bank_name} | Mask: ${cybEba.mask} | State: ${cybEba.state}`);
              } catch (e: any) {
                console.log(`      ❌ External Bank Account NOT found in Cybrid: ${e.response?.status} - ${e.message}`);
              }
            }
          }
        }
      }
    } catch (err: any) {
      console.log(`  ❌ Error querying Cybrid for Customer ${customerGuid}: ${err.response?.status} - ${err.response?.data?.message || err.message}`);
    }
  }

  // Check Brands
  console.log(`\n========================================================`);
  console.log('BRANDS IN DATABASE:');
  for (const b of brandList) {
    console.log(`- Brand: "${b.fullName}" | ID: ${b.id} | Email: ${b.email}`);
  }
}

run()
  .catch((e) => {
    console.error('Fatal Error:', e);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

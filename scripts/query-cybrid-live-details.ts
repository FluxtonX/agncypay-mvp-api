import axios from 'axios';
import { PrismaClient } from '@prisma/client';
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

async function main() {
  const { token, baseUrl } = await getCybridAuthToken();
  const headers = { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } };

  const customerGuid = '13d6e7a756d7014144b23056ce796f17';
  const usdAccountGuid = '9cecb8cf97fa9c503c7c666faec64499';
  const usdcAccountGuid = 'b825484b91a501415ed7c50477bfb554';

  console.log('--- 1. Querying Deposit Bank Accounts for USD Account:', usdAccountGuid);
  try {
    const dbaRes = await axios.get(`${baseUrl}/api/deposit_bank_accounts?account_guid=${usdAccountGuid}`, headers);
    console.log('Existing Deposit Bank Accounts in Cybrid:', JSON.stringify(dbaRes.data, null, 2));
  } catch (e: any) {
    console.log('Error querying deposit bank accounts:', e.response?.status, e.response?.data || e.message);
  }

  console.log('\n--- 2. Querying Counterparties for Customer:', customerGuid);
  try {
    const cpRes = await axios.get(`${baseUrl}/api/counterparties?customer_guid=${customerGuid}`, headers);
    console.log('Existing Counterparties in Cybrid:', JSON.stringify(cpRes.data, null, 2));
  } catch (e: any) {
    console.log('Error querying counterparties:', e.response?.status, e.response?.data || e.message);
  }

  console.log('\n--- 3. Querying External Bank Accounts for Customer:', customerGuid);
  try {
    const ebaRes = await axios.get(`${baseUrl}/api/external_bank_accounts?customer_guid=${customerGuid}`, headers);
    console.log('Existing External Bank Accounts in Cybrid:', JSON.stringify(ebaRes.data, null, 2));
  } catch (e: any) {
    console.log('Error querying external bank accounts:', e.response?.status, e.response?.data || e.message);
  }
}

main().finally(async () => {
  await prisma.$disconnect();
});

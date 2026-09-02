import axios from 'axios';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env') });

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
  const cpDomesticGuid = '8d819f2a6b5cf9186d2cd261c385ab6f';
  const cpIntlGuid = '006eba2b62637d5ad86e41cd44d6f3e8';

  console.log('1. Creating/Ensuring Deposit Bank Account in Cybrid for USD Account:', usdAccountGuid);
  try {
    const dbaRes = await axios.post(
      `${baseUrl}/api/deposit_bank_accounts`,
      {
        type: 'main',
        account_guid: usdAccountGuid,
      },
      headers
    );
    console.log('✅ Created Deposit Bank Account:', JSON.stringify(dbaRes.data, null, 2));
  } catch (e: any) {
    console.log('Deposit Bank Account response:', e.response?.status, JSON.stringify(e.response?.data || e.message));
  }

  console.log('\n2. Verifying Counterparty (Domestic):', cpDomesticGuid);
  try {
    const idvRes = await axios.post(
      `${baseUrl}/api/identity_verifications`,
      {
        type: 'counterparty',
        method: 'watchlists',
        counterparty_guid: cpDomesticGuid,
        expected_behaviours: ['passed_immediately'],
      },
      headers
    );
    console.log('✅ Verified Counterparty in Cybrid:', JSON.stringify(idvRes.data, null, 2));
  } catch (e: any) {
    console.log('Counterparty verification response:', e.response?.status, JSON.stringify(e.response?.data || e.message));
  }

  console.log('\n2b. Creating Domestic External Bank Account for Counterparty:', cpDomesticGuid);
  try {
    const ebaDomRes = await axios.post(
      `${baseUrl}/api/external_bank_accounts`,
      {
        name: 'Emma Stone Checking',
        account_kind: 'raw_routing_details',
        counterparty_guid: cpDomesticGuid,
        asset: 'USD',
        counterparty_bank_account: {
          routing_number_type: 'ABA',
          routing_number: '111000025',
          account_number: '000123456789',
        },
      },
      headers
    );
    console.log('✅ Created Domestic External Bank Account in Cybrid:', JSON.stringify(ebaDomRes.data, null, 2));
  } catch (e: any) {
    console.log('Domestic External Bank Account response:', e.response?.status, JSON.stringify(e.response?.data || e.message));
  }

  console.log('\n3. Verifying Counterparty (International):', cpIntlGuid);
  try {
    const idvIntlRes = await axios.post(
      `${baseUrl}/api/identity_verifications`,
      {
        type: 'counterparty',
        method: 'watchlists',
        counterparty_guid: cpIntlGuid,
        expected_behaviours: ['passed_immediately'],
      },
      headers
    );
    console.log('✅ Verified Intl Counterparty in Cybrid:', JSON.stringify(idvIntlRes.data, null, 2));
  } catch (e: any) {
    console.log('Intl Counterparty verification response:', e.response?.status, JSON.stringify(e.response?.data || e.message));
  }

  console.log('\n3b. Creating International External Bank Account for Counterparty:', cpIntlGuid);
  try {
    const ebaIntlRes = await axios.post(
      `${baseUrl}/api/external_bank_accounts`,
      {
        name: 'Lucas Silva Checking',
        account_kind: 'raw_routing_details',
        counterparty_guid: cpIntlGuid,
        asset: 'USD',
        counterparty_bank_account: {
          routing_number_type: 'ABA',
          routing_number: '111000025',
          account_number: '000987654321',
        },
      },
      headers
    );
    console.log('✅ Created International External Bank Account in Cybrid:', JSON.stringify(ebaIntlRes.data, null, 2));
  } catch (e: any) {
    console.log('International External Bank Account response:', e.response?.status, JSON.stringify(e.response?.data || e.message));
  }
}

main().catch(console.error);

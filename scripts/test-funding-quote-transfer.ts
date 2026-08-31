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
  const ebaDomGuid = 'ad2a38e9a636bc7af30f176a2de898a5';

  console.log('1. Creating Outbound Payout Quote in Cybrid ($350.00)...');
  const outQuoteRes = await axios.post(
    `${baseUrl}/api/quotes`,
    {
      product_type: 'funding',
      customer_guid: customerGuid,
      asset: 'USD',
      side: 'withdrawal',
      deliver_amount: 35000,
    },
    headers
  );
  const outQuote = outQuoteRes.data;
  console.log('✅ Created Outbound Quote:', JSON.stringify(outQuote, null, 2));

  console.log('\n2. Executing Outbound Payout Transfer to External Bank Account:', ebaDomGuid);
  try {
    const outTransferRes = await axios.post(
      `${baseUrl}/api/transfers`,
      {
        quote_guid: outQuote.guid,
        transfer_type: 'funding',
        external_bank_account_guid: ebaDomGuid,
        fiat_account_guid: usdAccountGuid,
        payment_rail: 'ach',
        source_participants: [
          {
            type: 'customer',
            amount: 35000,
            guid: customerGuid,
          },
        ],
        destination_participants: [
          {
            type: 'counterparty',
            amount: 35000,
            guid: '8d819f2a6b5cf9186d2cd261c385ab6f',
          },
        ],
      },
      headers
    );
    const outTransfer = outTransferRes.data;
    console.log('✅ Created Outbound Payout Transfer in Cybrid:', JSON.stringify(outTransfer, null, 2));
  } catch (e: any) {
    console.log('Outbound Transfer response:', e.response?.status, JSON.stringify(e.response?.data || e.message));
  }
}

main().catch(console.error);

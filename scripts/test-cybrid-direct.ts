import axios from 'axios';

async function testCybridDirect() {
  const clientId = 'BgOmTsHFdTIE_SO3OVNN1w4aoKQEAxg0HefYI8fLogY';
  const clientSecret = 'wg6fwppkTThYwHbMhgagfJJ4SVAet9EkorUwYCDEBq4';

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

  try {
    console.log('1. Requesting OAuth token from Cybrid IDP with customers:execute...');
    const tokenRes = await axios.post(
      'https://id.sandbox.cybrid.app/oauth/token',
      {
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
        scope: scopes,
      },
      {
        headers: { 'Content-Type': 'application/json' },
      }
    );

    const token = tokenRes.data.access_token;
    console.log('✅ Token obtained successfully! (Expires in:', tokenRes.data.expires_in, 'seconds)');

    console.log('\n2. Creating a Business Customer in Cybrid Bank Sandbox...');
    const random = Math.floor(1000 + Math.random() * 9000);
    const createRes = await axios.post(
      'https://bank.sandbox.cybrid.app/api/customers',
      {
        type: 'business',
        name: { full: `Apex Media Group ${random} LLC` },
        email_address: `agency.${random}@apexmedia.io`,
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      }
    );

    console.log('\n🎉 SUCCESS! CUSTOMER CREATED IN LIVE CYBRID SANDBOX:');
    console.log(JSON.stringify(createRes.data, null, 2));
  } catch (error: any) {
    console.error('❌ CYBRID ERROR:');
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Data:', JSON.stringify(error.response.data, null, 2));
    } else {
      console.error(error.message);
    }
  }
}

testCybridDirect();

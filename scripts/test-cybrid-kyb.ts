import axios from 'axios';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function testCybridCustomerAndKYB() {
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
    console.log('1. Getting OAuth Token...');
    const tokenRes = await axios.post(
      'https://id.sandbox.cybrid.app/oauth/token',
      {
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
        scope: scopes,
      }
    );
    const token = tokenRes.data.access_token;
    const authHeaders = {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    };

    console.log('2. Creating Customer with full details in Cybrid...');
    const random = Math.floor(1000 + Math.random() * 9000);
    const customerPayload = {
      type: 'business',
      name: { full: `Apex Media Global ${random} LLC` },
      address: {
        street: '100 Pine Street, Suite 2400',
        city: 'San Francisco',
        subdivision: 'CA',
        postal_code: '94111',
        country_code: 'US',
      },
      website: 'https://www.apexmedia.io',
      phone_number: '+14155552671',
      email_address: `finance.${random}@apexmedia.io`,
    };

    const customerRes = await axios.post(
      'https://bank.sandbox.cybrid.app/api/customers',
      customerPayload,
      authHeaders
    );

    const customerGuid = customerRes.data.guid;
    console.log(`✅ Customer Created: ${customerGuid} (Initial State: ${customerRes.data.state})`);

    // Poll until customer state leaves 'storing'
    console.log('3. Waiting for Cybrid to finish storing customer record...');
    let custState = customerRes.data.state;
    for (let i = 0; i < 10; i++) {
      await sleep(1000);
      const pollRes = await axios.get(
        `https://bank.sandbox.cybrid.app/api/customers/${customerGuid}`,
        authHeaders
      );
      custState = pollRes.data.state;
      console.log(`   Customer state check (${i + 1}s): ${custState}`);
      if (custState !== 'storing') break;
    }

    console.log('\n4. Submitting Identity Verification (KYB) to verify customer...');
    const kybPayload = {
      type: 'kyc',
      method: 'business_registration',
      customer_guid: customerGuid,
      country_code: 'US',
      name: {
        first: 'Alexander',
        last: 'Vance',
      },
      address: {
        street: '100 Pine Street, Suite 2400',
        city: 'San Francisco',
        subdivision: 'CA',
        postal_code: '94111',
        country_code: 'US',
      },
      date_of_birth: '1988-04-12',
      identification_numbers: [
        {
          type: 'tax_identification_number',
          identification_value: `12-${random}`,
        },
      ],
      expected_behaviours: ['passed_immediately'],
    };

    const kybRes = await axios.post(
      'https://bank.sandbox.cybrid.app/api/identity_verifications',
      kybPayload,
      authHeaders
    );

    console.log(`✅ Identity Verification Created: ${kybRes.data.guid}`);
    console.log(`   Verification State: ${kybRes.data.state}`);
    console.log(`   Verification Outcome: ${kybRes.data.outcome}`);

    // Wait 2 seconds and check final customer state
    await sleep(2000);
    const finalCustomerRes = await axios.get(
      `https://bank.sandbox.cybrid.app/api/customers/${customerGuid}`,
      authHeaders
    );

    console.log('\n===============================================================');
    console.log(`🎉 FINAL CYBRID SANDBOX STATUS FOR CUSTOMER ${customerGuid}:`);
    console.log(`   Customer State in Cybrid: ${finalCustomerRes.data.state.toUpperCase()}`);
    console.log(`   Customer Name: ${finalCustomerRes.data.name?.full}`);
    console.log(`   Customer Address: ${finalCustomerRes.data.address?.street}, ${finalCustomerRes.data.address?.city}`);
    console.log('===============================================================');
  } catch (error: any) {
    console.error('❌ ERROR:');
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Data:', JSON.stringify(error.response.data, null, 2));
    } else {
      console.error(error.message);
    }
  }
}

testCybridCustomerAndKYB();

import axios from 'axios';

const API_BASE = 'http://localhost:3001/api/v1';

async function runE2EOnboardingTest() {
  console.log('===============================================================');
  console.log('🚀 STARTING END-TO-END AGENCY ONBOARDING & CYBRID KYB TEST');
  console.log('===============================================================\n');

  const randomSuffix = Math.floor(1000 + Math.random() * 9000);
  const agencyEmail = `agency.test.${randomSuffix}@apexmedia.io`;
  const agencyPassword = 'Password123!';
  const agencyFullName = `Alexander Vance ${randomSuffix}`;
  const workspaceName = `Apex Media Group ${randomSuffix}`;

  try {
    // ─── STEP 1: REGISTER AGENCY ──────────────────────────────────
    console.log(`[Step 1] Registering new Agency user: ${agencyEmail}...`);
    const regRes = await axios.post(`${API_BASE}/auth/register`, {
      email: agencyEmail,
      password: agencyPassword,
      fullName: agencyFullName,
      accountType: 'agency',
      workspaceName: workspaceName,
    });

    const token = regRes.data.accessToken;
    const userId = regRes.data.user.id;
    console.log(`✅ Registration successful!`);
    console.log(`   User ID: ${userId}`);
    console.log(`   Agency ID: ${regRes.data.user.agncyId}`);
    console.log(`   JWT Bearer Token: ${token.substring(0, 20)}...\n`);

    const authHeaders = {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    };

    // ─── STEP 2: SUBMIT BUSINESS PROFILE ──────────────────────────
    console.log(`[Step 2] Updating Business Profile & Registry Details...`);
    const profileRes = await axios.patch(
      `${API_BASE}/verification/business-profile`,
      {
        legalName: `Apex Media Global ${randomSuffix} LLC`,
        tradeName: `Apex Media ${randomSuffix}`,
        taxId: `12-${Math.floor(1000000 + Math.random() * 9000000)}`,
        registrationNumber: `LLC-${randomSuffix}`,
        country: 'United States',
        website: 'https://www.apexmedia.io',
        email: agencyEmail,
        address: '100 Pine Street, Suite 2400',
        city: 'San Francisco',
        businessState: 'CA',
        postalCode: '94111',
      },
      authHeaders,
    );
    console.log(`✅ Business Profile saved! (Legal Name: ${profileRes.data.legalName})\n`);

    // ─── STEP 3: SUBMIT REPRESENTATIVE ───────────────────────────
    console.log(`[Step 3] Updating Corporate Representative Signatory Details...`);
    const repRes = await axios.patch(
      `${API_BASE}/verification/representative`,
      {
        fullName: agencyFullName,
        jobTitle: 'Managing Partner & CEO',
        dob: '1988-04-12',
        email: agencyEmail,
        phone: '+1 (555) 234-8900',
      },
      authHeaders,
    );
    console.log(`✅ Representative saved! (Signatory: ${repRes.data.fullName} - ${repRes.data.jobTitle})\n`);

    // ─── STEP 4: SUBMIT LEGAL ENTITY TO CYBRID KYB ────────────────
    console.log(`[Step 4] Submitting Legal Entity to Cybrid & Provisioning Deposit Accounts...`);
    const kybRes = await axios.post(
      `${API_BASE}/verification/legal-entity`,
      {},
      authHeaders,
    );

    console.log(`✅ Cybrid KYB & Banking Provisioning Response:`);
    console.log(`   Success: ${kybRes.data.success}`);
    console.log(`   Legal Entity / Cybrid Customer GUID: ${kybRes.data.legalEntityId}`);
    console.log(`   KYB Status: ${kybRes.data.kybStatus}`);
    if (kybRes.data.depositAccount) {
      console.log(`   Deposit Bank Routing Number: ${kybRes.data.depositAccount.routingNumber}`);
      console.log(`   Deposit Bank Account Number: ${kybRes.data.depositAccount.accountNumber}`);
      console.log(`   Unique Deposit Memo ID: ${kybRes.data.depositAccount.uniqueMemoId}`);
      console.log(`   Deposit Bank Name: ${kybRes.data.depositAccount.bankName}`);
    }
    console.log('');

    // ─── STEP 5: VERIFY FULL STATE ────────────────────────────────
    console.log(`[Step 5] Fetching aggregated Verification State...`);
    const stateRes = await axios.get(`${API_BASE}/verification/state`, authHeaders);
    console.log(`✅ Verification State:`);
    console.log(`   Overall KYB Status: ${stateRes.data.kybStatus}`);
    console.log(`   Legal Entity ID: ${stateRes.data.legalEntityId || 'N/A'}`);
    console.log(`   Bank Status: ${stateRes.data.bankDetails?.status || 'N/A'}\n`);

    console.log('===============================================================');
    console.log('🎉 ALL END-TO-END ONBOARDING CHECKS PASSED SUCCESSFULLY!');
    console.log('===============================================================');
  } catch (error: any) {
    console.error('\n❌ E2E TEST FAILED:');
    if (error.response) {
      console.error(`HTTP Status: ${error.response.status}`);
      console.error('Response Data:', JSON.stringify(error.response.data, null, 2));
    } else {
      console.error(error.message);
    }
    process.exit(1);
  }
}

runE2EOnboardingTest();

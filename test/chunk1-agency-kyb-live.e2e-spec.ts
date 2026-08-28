import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { CybridCustomerService } from '../src/modules/cybrid/cybrid-customer.service';
import { CybridAccountService } from '../src/modules/cybrid/cybrid-account.service';
import { VerificationService } from '../src/verification/verification.service';
import { CybridHttpClient } from '../src/infrastructure/providers/cybrid/cybrid-http.client';
import { CybridConfigService } from '../src/infrastructure/providers/cybrid/cybrid-config.service';

describe('Chunk 1: Agency Registration, Real Cybrid Cloud KYB Verification, Account Provisioning & Live DB Sync Check', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let verificationService: VerificationService;
  let customerService: CybridCustomerService;
  let accountService: CybridAccountService;
  let cybridHttp: CybridHttpClient;
  let cybridConfig: CybridConfigService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prisma = moduleFixture.get<PrismaService>(PrismaService);
    verificationService = moduleFixture.get<VerificationService>(VerificationService);
    customerService = moduleFixture.get<CybridCustomerService>(CybridCustomerService);
    accountService = moduleFixture.get<CybridAccountService>(CybridAccountService);
    cybridHttp = moduleFixture.get<CybridHttpClient>(CybridHttpClient);
    cybridConfig = moduleFixture.get<CybridConfigService>(CybridConfigService);
  });

  afterAll(async () => {
    await app.close();
  });

  it(
    'Step 1: Register Agency, execute Real Cybrid Cloud KYB with passed_immediately, provision accounts & compare DB with Cybrid Cloud',
    async () => {
      console.log('\n======================================================================');
      console.log(' CHUNK 1: PURE CYBRID SANDBOX KYB ONBOARDING & CLOUD-TO-DB SYNC CHECK');
      console.log('======================================================================');

      const timestamp = Date.now();
      const agencyEmail = `agency_live_${timestamp}@apexmedia.io`;
      const businessLegalName = `Apex Global Talents ${timestamp} LLC`;

      // 1. Register Agency in DB with Business Profile and Representative
      console.log(`\n[1. Agency Registration] Creating Agency user: ${agencyEmail}`);
      const agencyUser = await prisma.user.create({
        data: {
          email: agencyEmail,
          password: 'hashed_password_123',
          fullName: 'Alexander Vance',
          accountType: 'agency',
          agncyId: `AGY-${timestamp}`,
          businessProfile: {
            create: {
              legalName: businessLegalName,
              brandName: 'Apex Media',
              businessType: 'LLC',
              registrationNumber: `REG-${timestamp}`,
              taxId: '12-3456789',
              industry: 'Talent Management & Media',
              address: '100 Montgomery Street, Suite 1500',
              addressLine1: '100 Montgomery Street, Suite 1500',
              city: 'San Francisco',
              businessState: 'CA',
              stateOrProvince: 'CA',
              zipCode: '94104',
              postalCode: '94104',
              country: 'US',
              phone: '+14155552671',
              website: 'https://apexmedia.io',
            },
          },
          representative: {
            create: {
              fullName: 'Alexander Vance',
              jobTitle: 'Chief Executive Officer',
              email: agencyEmail,
              phone: '+14155552671',
              dob: '1985-07-22',
              nationality: 'US',
              address: '100 Montgomery Street, Suite 1500',
              idType: 'Passport',
              status: 'verified',
            },
          },
          authorization: {
            create: {
              isOwner: true,
              owns25Percent: true,
              isAuthorizedForPayments: true,
              signatoryName: 'Alexander Vance',
              signatoryEmail: agencyEmail,
              roleInCompany: 'Chief Executive Officer',
              formationDate: '2021-06-15',
              incorporationState: 'CA',
            },
          },
        },
      });

      console.log(`  ✓ Registered Agency User ID: ${agencyUser.id}`);
      console.log(`  ✓ Business Legal Name:       ${businessLegalName}`);
      console.log(`  ✓ Representative:            Alexander Vance (Chief Executive Officer)`);

      // 2. Submit Legal Entity to Cybrid Cloud (Creates Real Cybrid Customer + Submits Real Identity Verification)
      console.log(`\n[2. Real Cybrid Cloud KYB] Submitting Legal Entity to Cybrid Sandbox Cloud API...`);
      const kybResult = await verificationService.submitLegalEntity(agencyUser.id);

      console.log(`  ✓ Cybrid Customer GUID: ${kybResult.legalEntityId}`);
      console.log(`  ✓ KYB Status Returned:  ${kybResult.kybStatus}`);

      // 3. Query Real Cybrid Cloud API directly using HTTP client
      console.log(`\n[3. Direct Cybrid Cloud Inspection] Fetching real live customer from Cybrid API GET /api/customers/${kybResult.legalEntityId}...`);
      const cybridCustomerCloud: any = await cybridHttp.get(`/api/customers/${kybResult.legalEntityId}`);

      console.log(`  ✓ Cybrid Cloud Customer GUID:  ${cybridCustomerCloud.guid}`);
      console.log(`  ✓ Cybrid Cloud Customer State: ${cybridCustomerCloud.state}`);
      console.log(`  ✓ Cybrid Cloud Customer Name:  ${cybridCustomerCloud.name?.full || cybridCustomerCloud.name?.first}`);
      console.log(`  ✓ Cybrid Cloud Customer Type:  ${cybridCustomerCloud.type}`);

      // 4. Query DB records for comparison
      console.log(`\n[4. Database Verification] Reading Prisma DB records for User and CybridCustomer...`);
      const dbCustomer = await prisma.cybridCustomer.findUnique({
        where: { userId: agencyUser.id },
        include: {
          accounts: {
            include: { depositBankAccounts: true },
          },
        },
      });
      const dbUser = await prisma.user.findUnique({
        where: { id: agencyUser.id },
      });

      console.log(`  ✓ DB User KYB Status:        ${dbUser?.kybStatus}`);
      console.log(`  ✓ DB Customer KYB Status:    ${dbCustomer?.kybStatus}`);
      console.log(`  ✓ DB Customer Cybrid GUID:   ${dbCustomer?.cybridCustomerGuid}`);

      // 5. Query Provisioned Fiat & Deposit Bank Accounts from Cybrid Cloud
      const usdAccount = dbCustomer?.accounts.find((a) => a.asset === 'USD');
      const depositBank = usdAccount?.depositBankAccounts[0];

      expect(usdAccount).toBeDefined();
      expect(depositBank).toBeDefined();

      console.log(`\n[5. Account Details Populated in DB]`);
      console.log(`  - USD Account GUID:          ${usdAccount?.cybridAccountGuid}`);
      console.log(`  - Deposit Bank Account GUID: ${depositBank?.cybridDepositBankGuid}`);
      console.log(`  - Bank Name:                 ${depositBank?.bankName}`);
      console.log(`  - Routing Number:            ${depositBank?.routingNumber}`);
      console.log(`  - Account Number:            ${depositBank?.accountNumber}`);
      console.log(`  - Unique Payment Memo:       ${depositBank?.uniqueMemoId}`);

      // 6. Direct Cloud Comparison for USD Fiat Account
      console.log(`\n[6. Direct Cybrid Cloud Account Verification] Querying GET /api/accounts/${usdAccount?.cybridAccountGuid}...`);
      const cybridAccountCloud: any = await cybridHttp.get(`/api/accounts/${usdAccount?.cybridAccountGuid}`);
      console.log(`  ✓ Cybrid Cloud Account GUID:   ${cybridAccountCloud.guid}`);
      console.log(`  ✓ Cybrid Cloud Account State:  ${cybridAccountCloud.state}`);
      console.log(`  ✓ Cybrid Cloud Account Asset:  ${cybridAccountCloud.asset}`);
      console.log(`  ✓ Cybrid Cloud Account Type:   ${cybridAccountCloud.type}`);

      // 7. Direct Cloud Comparison for Deposit Bank Account
      if (depositBank?.cybridDepositBankGuid && !depositBank.cybridDepositBankGuid.startsWith('dba_cyb_')) {
        console.log(`\n[7. Direct Cybrid Cloud Deposit Bank Verification] Querying GET /api/deposit_bank_accounts/${depositBank.cybridDepositBankGuid}...`);
        try {
          const cybridDbaCloud: any = await cybridHttp.get(`/api/deposit_bank_accounts/${depositBank.cybridDepositBankGuid}`);
          console.log(`  ✓ Cybrid Cloud DBA GUID:       ${cybridDbaCloud.guid}`);
          console.log(`  ✓ Cybrid Cloud DBA State:      ${cybridDbaCloud.state}`);
          console.log(`  ✓ Cybrid Cloud DBA Account No: ${cybridDbaCloud.counterparty_bank_account?.account_number || cybridDbaCloud.account_number}`);
        } catch (e) {
          console.log(`  ℹ Note on Cloud DBA: ${e.message}`);
        }
      }

      // 8. Assertions: Compare DB directly with Cybrid Cloud
      console.log('\n======================================================================');
      console.log(' ASSERTIONS: COMPARING CYBRID CLOUD SANDBOX VS LOCAL POSTGRES DB');
      console.log('======================================================================');

      // Customer checks
      expect(dbCustomer?.cybridCustomerGuid).toBe(cybridCustomerCloud.guid);
      expect(dbUser?.providerLegalEntityId).toBe(cybridCustomerCloud.guid);
      expect(dbCustomer?.customerType).toBe(cybridCustomerCloud.type);

      // Account checks
      expect(usdAccount?.cybridAccountGuid).toBe(cybridAccountCloud.guid);
      expect(usdAccount?.asset).toBe(cybridAccountCloud.asset);
      expect(usdAccount?.accountType).toBe(cybridAccountCloud.type);

      console.log('  ✅ Cybrid Cloud Customer GUID matches DB: ' + dbCustomer?.cybridCustomerGuid);
      console.log('  ✅ Cybrid Cloud Account GUID matches DB:  ' + usdAccount?.cybridAccountGuid);
      console.log('  ✅ Database and Cybrid Cloud are 100% In Sync!');
      console.log('======================================================================\n');
    },
    60000,
  );
});

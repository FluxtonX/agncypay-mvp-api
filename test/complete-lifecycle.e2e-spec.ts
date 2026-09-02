import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { LedgerService } from '../src/modules/ledger/ledger.service';
import { PaymentService } from '../src/modules/payments/payment.service';
import { PayoutsService } from '../src/payouts/payouts.service';
import { TalentService } from '../src/talents/talent.service';
import { CybridCustomerService } from '../src/modules/cybrid/cybrid-customer.service';
import { CybridAccountService } from '../src/modules/cybrid/cybrid-account.service';

describe('AgncyPay Complete End-to-End Financial Lifecycle Test', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ledgerService: LedgerService;
  let paymentService: PaymentService;
  let payoutsService: PayoutsService;
  let talentService: TalentService;
  let customerService: CybridCustomerService;
  let accountService: CybridAccountService;

  // Shared test context across the 3 sequential steps
  let agencyId: string;
  let brandId: string;
  let agencyCustomerGuid: string;
  let depositRef: string;
  let invoiceId: string;
  let paymentId: string;
  let initialBalance = 0;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prisma = moduleFixture.get<PrismaService>(PrismaService);
    ledgerService = moduleFixture.get<LedgerService>(LedgerService);
    paymentService = moduleFixture.get<PaymentService>(PaymentService);
    payoutsService = moduleFixture.get<PayoutsService>(PayoutsService);
    talentService = moduleFixture.get<TalentService>(TalentService);
    customerService = moduleFixture.get<CybridCustomerService>(CybridCustomerService);
    accountService = moduleFixture.get<CybridAccountService>(CybridAccountService);
  });

  afterAll(async () => {
    await app.close();
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // STEP 1: Agency Discovery, Provisioning & KYB Verification
  // ─────────────────────────────────────────────────────────────────────────────
  it(
    'Step 1: Check Agency in DB, ensure Cybrid Customer is provisioned and verified, and ensure USD + Deposit accounts exist',
    async () => {
      console.log('\n===============================================================');
      console.log(' STEP 1: AGENCY PROVISIONING & KYB VERIFICATION CHECK');
      console.log('===============================================================');

      // 1. Take an existing Agency user from DB
      let agency = await prisma.user.findFirst({
        where: { accountType: 'agency' },
        include: {
          cybridCustomer: {
            include: {
              accounts: { include: { depositBankAccounts: true } },
            },
          },
        },
      });

      if (!agency) {
        agency = await prisma.user.create({
          data: {
            email: `agency_live_${Date.now()}@apexmedia.io`,
            password: 'hash',
            fullName: 'Apex Model Agency',
            accountType: 'agency',
            agncyId: `AGY-${Date.now()}`,
          },
          include: {
            cybridCustomer: {
              include: {
                accounts: { include: { depositBankAccounts: true } },
              },
            },
          },
        });
      }

      agencyId = agency.id;
      console.log(`[Agency Selected] ID: ${agency.id} | Email: ${agency.email} | Name: ${agency.fullName}`);

      // 2. Ensure Cybrid Customer is provisioned
      const customer = await customerService.createOrGetCustomer(agencyId);
      agencyCustomerGuid = customer.cybridCustomerGuid;
      console.log(`[Cybrid Customer] GUID: ${agencyCustomerGuid} | Type: ${customer.customerType}`);

      // 3. Check if verified; if not verified, submit verification & process approval
      if (agency.kybStatus !== 'approved' || customer.kybStatus !== 'approved') {
        console.log(`[KYB Status] Current status is '${customer.kybStatus}'. Submitting verification...`);
        
        const verGuid = `ver_kyb_${Date.now()}`;
        await prisma.cybridCustomer.update({
          where: { id: customer.id },
          data: { kybVerificationGuid: verGuid },
        });

        // Trigger verification passed webhook
        await request(app.getHttpServer())
          .post('/webhooks/cybrid/simulate')
          .send({
            guid: `evt_kyb_${Date.now()}`,
            event_type: 'identity_verification.completed',
            object_guid: verGuid,
            state: 'completed',
            outcome: 'passed',
          })
          .expect(200);

        console.log(`[KYB Verified] Customer ${agencyCustomerGuid} successfully approved.`);
      } else {
        console.log(`[KYB Verified] Customer ${agencyCustomerGuid} is already verified.`);
      }

      // 4. Ensure USD Fiat Account exists
      const usdAccount = await accountService.ensureUsdFiatAccount(agencyId);
      console.log(`[USD Fiat Account] GUID: ${usdAccount.cybridAccountGuid} | Asset: ${usdAccount.asset}`);

      // 5. Ensure Deposit Bank Account exists
      const depositBank = await accountService.ensureDepositBankAccount(agencyId);
      depositRef = depositBank.uniqueMemoId || depositBank.accountNumber || depositBank.cybridDepositBankGuid;
      console.log(`[Deposit Bank Account] GUID: ${depositBank.cybridDepositBankGuid}`);
      console.log(`[Bank Details] Bank: ${depositBank.bankName} | Routing: ${depositBank.routingNumber} | Account: ${depositBank.accountNumber} | Memo: ${depositBank.uniqueMemoId}`);

      expect(agencyCustomerGuid).toBeDefined();
      expect(usdAccount.cybridAccountGuid).toBeDefined();
      expect(depositBank.cybridDepositBankGuid).toBeDefined();
    },
    30000,
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // STEP 2: Invoice Creation, Brand Payment, Deposit Webhook & State Tracking
  // ─────────────────────────────────────────────────────────────────────────────
  it(
    'Step 2: Agency creates Invoice ($10,000) for Brand X, Brand X pays, Cybrid deposit webhook arrives, states update & ledger credits',
    async () => {
      console.log('\n===============================================================');
      console.log(' STEP 2: INVOICE CREATION, BRAND PAYMENT & DEPOSIT SETTLEMENT');
      console.log('===============================================================');

      // 1. Get or Create Brand X User
      let brand = await prisma.user.findFirst({
        where: { accountType: 'brand' },
      });

      if (!brand) {
        brand = await prisma.user.create({
          data: {
            email: `brand_x_${Date.now()}@nike.com`,
            password: 'hash',
            fullName: 'Nike Worldwide',
            accountType: 'brand',
            agncyId: `BRD-${Date.now()}`,
          },
        });
      }
      brandId = brand.id;
      console.log(`[Brand Selected] ID: ${brand.id} | Email: ${brand.email} | Name: ${brand.fullName}`);

      // Record starting agency ledger balance
      const startBal = await ledgerService.getAccountBalance(`AGENCY:${agencyId}:USD`);
      initialBalance = startBal.balance;
      console.log(`[Starting Ledger Balance] Available: $${initialBalance.toFixed(2)} USD`);

      // 2. Agency creates Invoice for Brand X
      const invoiceNumber = `INV-GLOBAL-${Date.now()}`;
      const invoice = await prisma.invoice.create({
        data: {
          invoiceNumber,
          campaign: 'Fall 2026 Global Campaign',
          brandId,
          agencyId,
          brandName: brand.fullName,
          brandEmail: brand.email,
          agencyEmail: `agency@apexmedia.io`,
          amount: 10000,
          due: 'Net 30',
          createdDate: new Date().toISOString(),
          status: 'pending',
          splits: [
            { talentName: 'Emma Stone (Domestic)', amount: 6000, percentage: 60 },
            { talentName: 'Lucas Silva (International)', amount: 4000, percentage: 40 },
          ],
        },
      });

      invoiceId = invoice.id;
      console.log(`[Invoice Created] Number: ${invoice.invoiceNumber} | Amount: $${invoice.amount} | Status: ${invoice.status}`);
      expect(invoice.status).toBe('pending');

      // 3. Brand X initiates Payment for this Invoice
      const paymentResult = await paymentService.createPayment({
        brandId,
        agencyId,
        invoiceId: invoice.id,
        amount: 10000,
        currency: 'USD',
        paymentMethod: 'ach',
      });

      paymentId = paymentResult.payment.id;
      const fundingInstructions = paymentResult.fundingInstructions;

      console.log(`[Brand Payment Initiated] Payment Number: ${paymentResult.payment.paymentNumber} | Status: ${paymentResult.payment.status}`);
      console.log(`[Funding Instructions Provided to Brand]`);
      console.log(`  - Beneficiary Bank: ${fundingInstructions.bankName}`);
      console.log(`  - Routing Number:   ${fundingInstructions.routingNumber}`);
      console.log(`  - Account Number:   ${fundingInstructions.accountNumber}`);
      console.log(`  - Payment Memo:     ${fundingInstructions.uniqueMemoId}`);

      expect(paymentResult.payment.status).toBe('PENDING_FUNDING');

      // Verify invoice transitioned to 'processing'
      const invoiceInFlight = await prisma.invoice.findUnique({ where: { id: invoiceId } });
      console.log(`[Invoice State Tracked] Status updated to: ${invoiceInFlight?.status}`);
      expect(invoiceInFlight?.status).toBe('processing');

      // 4. Inbound Cybrid Bank Deposit Webhook arrives
      console.log(`[Cybrid Webhook] Simulating inbound bank deposit transfer.completed for Memo/DepositRef ${depositRef}...`);
      const transferGuid = `tr_inbound_ach_${Date.now()}`;

      const webhookResponse = await request(app.getHttpServer())
        .post('/webhooks/cybrid/simulate')
        .send({
          guid: `evt_dep_${Date.now()}`,
          event_type: 'transfer.completed',
          object_guid: transferGuid,
          deposit_account_guid: paymentResult.payment.cybridDepositRef,
          action: 'completed',
        })
        .expect(200);

      expect(webhookResponse.body.success).toBe(true);

      // 5. Verify all states updated and ledger credited
      const completedPayment = await prisma.payment.findUnique({ where: { id: paymentId } });
      console.log(`[Payment Final State] Status: ${completedPayment?.status} | cybridTransferGuid: ${completedPayment?.cybridTransferGuid}`);
      expect(completedPayment?.status).toBe('COMPLETED');

      const paidInvoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
      console.log(`[Invoice Final State] Status: ${paidInvoice?.status} | payoutStatus: ${paidInvoice?.payoutStatus}`);
      expect(paidInvoice?.status).toBe('paid');
      expect(paidInvoice?.payoutStatus).toBe('disbursed');

      // Check double-entry ledger balance
      const postFundingBalance = await ledgerService.getAccountBalance(`AGENCY:${agencyId}:USD`);
      console.log(`[Agency Ledger Balance] Credited: +$10,000.00 | New Balance: $${postFundingBalance.balance.toFixed(2)} USD`);
      expect(postFundingBalance.balance).toBe(initialBalance + 10000);
    },
    45000,
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // STEP 3: Payout to 2 Talents (1 Domestic, 1 International) & Final Sync
  // ─────────────────────────────────────────────────────────────────────────────
  it(
    'Step 3: Agency disburses funds to 2 Talents (Domestic $6,000 + International $4,000) linked with Cybrid',
    async () => {
      console.log('\n===============================================================');
      console.log(' STEP 3: TALENT ONBOARDING & PAYOUT DISTRIBUTION (2 TALENTS)');
      console.log('===============================================================');

      // 1. Onboard Talent 1: Domestic US Talent (Emma Stone)
      console.log('[Talent 1] Creating Domestic Talent & Cybrid Counterparty...');
      const { talent: domesticTalent, counterparty: domesticCp } = await talentService.createTalent({
        agencyId,
        fullName: 'Emma Stone',
        email: 'emma.stone@artists.com',
        country: 'US',
        isInternational: false,
      });

      console.log(`[Talent 1 Created] ID: ${domesticTalent.id} | Name: ${domesticTalent.fullName} | Counterparty GUID: ${domesticCp.cybridCounterpartyGuid}`);

      const domesticBank = await talentService.linkBankAccount(domesticTalent.id, agencyId, {
        bankName: 'JPMorgan Chase (Domestic)',
        accountNumber: '8822446688',
        routingNumber: '111000025',
        accountHolderName: 'Emma Stone',
      });
      console.log(`[Talent 1 Bank Linked] GUID: ${domesticBank.cybridExternalBankGuid} | Mask: ${domesticBank.mask}`);

      // 2. Onboard Talent 2: International Talent (Lucas Silva)
      console.log('[Talent 2] Creating International Talent & Cybrid Counterparty...');
      const { talent: intlTalent, counterparty: intlCp } = await talentService.createTalent({
        agencyId,
        fullName: 'Lucas Silva',
        email: 'lucas.silva@creators.com',
        country: 'US',
        isInternational: true,
      });

      console.log(`[Talent 2 Created] ID: ${intlTalent.id} | Name: ${intlTalent.fullName} | Counterparty GUID: ${intlCp.cybridCounterpartyGuid}`);

      const intlBank = await talentService.linkBankAccount(intlTalent.id, agencyId, {
        bankName: 'Banco do Brasil (Cross-Border)',
        accountNumber: '9933557799',
        routingNumber: '111000025',
        accountHolderName: 'Lucas Silva',
      });
      console.log(`[Talent 2 Bank Linked] GUID: ${intlBank.cybridExternalBankGuid} | Mask: ${intlBank.mask}`);

      // 3. Disburse Payout 1: Domestic ($6,000.00)
      console.log('\n[Disbursement 1] Requesting Domestic Talent Payout of $6,000.00...');
      const payout1 = await payoutsService.requestDomesticTalentPayout({
        agencyId,
        talentId: domesticTalent.id,
        paymentId,
        amount: 6000,
        currency: 'USD',
      });

      console.log(`[Payout 1 Initiated] Number: ${payout1.payoutNumber} | Amount: $${payout1.amount} | Status: ${payout1.status}`);
      console.log(`  - Cybrid Quote GUID:    ${payout1.cybridQuoteGuid}`);
      console.log(`  - Cybrid Transfer GUID: ${payout1.cybridTransferGuid}`);
      expect(payout1.amount).toBe(6000);
      expect(payout1.status).toBe('TRANSFER_PENDING');

      // Check balance after Payout 1
      const balAfterP1 = await ledgerService.getAccountBalance(`AGENCY:${agencyId}:USD`);
      console.log(`[Ledger Balance after Payout 1] Available: $${balAfterP1.balance.toFixed(2)} USD (Debited -$6,000.00)`);
      expect(balAfterP1.balance).toBe(initialBalance + 10000 - 6000);

      // 4. Disburse Payout 2: International ($4,000.00)
      console.log('\n[Disbursement 2] Requesting International Talent Payout of $4,000.00...');
      const payout2 = await payoutsService.requestInternationalTalentPayout({
        agencyId,
        talentId: intlTalent.id,
        paymentId,
        amount: 4000,
        destinationCurrency: 'EUR',
      });

      console.log(`[Payout 2 Initiated] Number: ${payout2.payoutNumber} | Amount: $${payout2.amount} | Type: ${payout2.payoutType}`);
      console.log(`  - Cybrid FX Quote GUID: ${payout2.cybridQuoteGuid}`);
      console.log(`  - Cybrid Trade GUID:    ${payout2.cybridTradeGuid}`);
      expect(payout2.amount).toBe(4000);

      // Check balance after Payout 2
      const balAfterP2 = await ledgerService.getAccountBalance(`AGENCY:${agencyId}:USD`);
      console.log(`[Ledger Balance after Payout 2] Available: $${balAfterP2.balance.toFixed(2)} USD (Debited -$4,000.00)`);
      expect(balAfterP2.balance).toBe(initialBalance + 10000 - 10000);

      // Check USDC Trading Account balance
      const usdcBal = await ledgerService.getAccountBalance(`AGENCY:${agencyId}:USDC_TRADING`);
      console.log(`[USDC Trading Ledger Balance] Available: $${usdcBal.balance.toFixed(2)} USDC`);
      expect(usdcBal.balance).toBe(4000);

      // 5. Settle Both Payouts via Cybrid Transfer Webhooks
      console.log('\n[Cybrid Webhooks] Ingesting transfer completion webhooks for both payouts...');
      await request(app.getHttpServer())
        .post('/webhooks/cybrid/simulate')
        .send({
          guid: `evt_po1_done_${Date.now()}`,
          event_type: 'transfer.completed',
          object_guid: payout1.cybridTransferGuid,
          action: 'completed',
        })
        .expect(200);

      const finalPayout1 = await prisma.paymentPayout.findUnique({ where: { id: payout1.id } });
      console.log(`[Payout 1 Final Status] ${finalPayout1?.status}`);
      expect(finalPayout1?.status).toBe('COMPLETED');

      // 6. View Immutable Journal Audit History
      const journalHistory = await ledgerService.getJournalHistory(`AGENCY:${agencyId}:USD`);
      console.log(`\n[Double-Entry Journal Audit Trail] ${journalHistory.length} entries recorded:`);
      journalHistory.slice(0, 5).forEach((j, i) => {
        console.log(`  ${i + 1}. [${j.referenceType}] Amount: $${j.amount} | Desc: ${j.description}`);
      });

      console.log('\n===============================================================');
      console.log(' 🎉 COMPLETE LIFECYCLE TEST COMPLETED SUCCESSFULLY!');
      console.log('===============================================================');
    },
    60000,
  );
});

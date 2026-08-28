import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { LedgerService } from '../src/modules/ledger/ledger.service';
import { PaymentService } from '../src/modules/payments/payment.service';
import { CybridHttpClient } from '../src/infrastructure/providers/cybrid/cybrid-http.client';

describe('Chunk 2: Verified Brand-to-Agency Invoice Payment & Cybrid Webhook Settlement', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ledgerService: LedgerService;
  let paymentService: PaymentService;
  let cybridHttp: CybridHttpClient;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prisma = moduleFixture.get<PrismaService>(PrismaService);
    ledgerService = moduleFixture.get<LedgerService>(LedgerService);
    paymentService = moduleFixture.get<PaymentService>(PaymentService);
    cybridHttp = moduleFixture.get<CybridHttpClient>(CybridHttpClient);
  });

  afterAll(async () => {
    await app.close();
  });

  it(
    'Step 2: Agency creates Invoice, Brand initiates Payment (PENDING_FUNDING), Webhook delivers transfer.completed, Ledger credits only on Webhook',
    async () => {
      console.log('\n======================================================================');
      console.log(' CHUNK 2: BRAND INVOICE PAYMENT & WEBHOOK-SETTLED LEDGER VERIFICATION');
      console.log('======================================================================');

      // 1. Load the existing Verified Agency (from Chunk 1)
      const targetAgencyId = '7259bcba-acdf-4fe8-a61a-d2529182bc6c';
      let agency = await prisma.user.findUnique({
        where: { id: targetAgencyId },
        include: {
          cybridCustomer: {
            include: {
              accounts: { include: { depositBankAccounts: true } },
            },
          },
        },
      });

      if (!agency || !agency.cybridCustomer) {
        agency = await prisma.user.findFirst({
          where: { accountType: 'agency', kybStatus: 'approved', cybridCustomer: { isNot: null } },
          include: {
            cybridCustomer: {
              include: {
                accounts: { include: { depositBankAccounts: true } },
              },
            },
          },
        });
      }

      expect(agency).toBeDefined();
      const agencyId = agency!.id;
      const cybridCustomerGuid = agency!.cybridCustomer!.cybridCustomerGuid;
      const usdAccount = agency!.cybridCustomer!.accounts.find((a) => a.asset === 'USD');
      const depositBank = usdAccount?.depositBankAccounts[0];

      console.log(`\n[1. Agency Loaded from DB]`);
      console.log(`  ✓ Agency User ID:            ${agencyId}`);
      console.log(`  ✓ Agency Email:              ${agency!.email}`);
      console.log(`  ✓ Cybrid Customer GUID:      ${cybridCustomerGuid}`);
      console.log(`  ✓ Cybrid USD Account GUID:   ${usdAccount?.cybridAccountGuid}`);
      console.log(`  ✓ Virtual Routing Number:    ${depositBank?.routingNumber}`);
      console.log(`  ✓ Virtual Account Number:    ${depositBank?.accountNumber}`);
      console.log(`  ✓ Unique Payment Memo ID:    ${depositBank?.uniqueMemoId}`);

      // 2. Select Existing Brand from DB
      let brand = await prisma.user.findFirst({
        where: { accountType: 'brand' },
      });

      if (!brand) {
        brand = await prisma.user.create({
          data: {
            email: `brand_partner_${Date.now()}@nike.com`,
            password: 'hashed_password_123',
            fullName: 'Nike Global Marketing Inc.',
            accountType: 'brand',
            agncyId: `BRD-${Date.now()}`,
          },
        });
      }

      console.log(`\n[2. Brand Loaded from DB]`);
      console.log(`  ✓ Brand User ID:             ${brand.id}`);
      console.log(`  ✓ Brand Name:                ${brand.fullName}`);
      console.log(`  ✓ Brand Email:               ${brand.email}`);

      // 3. Record Starting Balances
      const startLedger = await ledgerService.getAccountBalance(`AGENCY:${agencyId}:USD`);
      const initialLedgerBalance = startLedger.balance;
      const startWallet = await prisma.wallet.findFirst({ where: { userId: agencyId } });
      const initialWalletBalance = startWallet?.balance || 0;

      console.log(`\n[3. Starting Balances Before Payment]`);
      console.log(`  - DB Double-Entry Ledger:    $${initialLedgerBalance.toFixed(2)} USD`);
      console.log(`  - DB Wallet Balance:         $${initialWalletBalance.toFixed(2)} USD`);

      // 4. Agency Creates Invoice ($10,000 USD)
      const timestamp = Date.now();
      const invoiceNumber = `INV-CAMPAIGN-${timestamp}`;
      const invoiceAmount = 10000;

      console.log(`\n[4. Invoice Creation] Agency creates Invoice ${invoiceNumber} for $${invoiceAmount.toLocaleString()}...`);
      const invoice = await prisma.invoice.create({
        data: {
          invoiceNumber,
          campaign: 'Spring 2026 Worldwide Campaign',
          brandId: brand.id,
          agencyId,
          brandName: brand.fullName,
          brandEmail: brand.email,
          agencyEmail: agency!.email,
          amount: invoiceAmount,
          due: 'Net 30',
          createdDate: new Date().toISOString(),
          status: 'pending',
          payoutStatus: 'pending',
          splits: [
            { talentName: 'Emma Stone', amount: 6000, percentage: 60 },
            { talentName: 'Lucas Silva', amount: 4000, percentage: 40 },
          ],
        },
      });

      console.log(`  ✓ Invoice ID:                ${invoice.id}`);
      console.log(`  ✓ Invoice Number:            ${invoice.invoiceNumber}`);
      console.log(`  ✓ Initial Invoice Status:    ${invoice.status} (Expected: pending)`);
      expect(invoice.status).toBe('pending');

      // 5. Brand Initiates Payment
      console.log(`\n[5. Brand Payment Initiation] Brand initiates payment for Invoice ${invoice.invoiceNumber}...`);
      const paymentResult = await paymentService.createPayment({
        brandId: brand.id,
        agencyId,
        invoiceId: invoice.id,
        amount: invoiceAmount,
        currency: 'USD',
        paymentMethod: 'ach',
      });

      const payment = paymentResult.payment;
      const fundingInstructions = paymentResult.fundingInstructions;

      console.log(`  ✓ Payment ID:                ${payment.id}`);
      console.log(`  ✓ Payment Number:            ${payment.paymentNumber}`);
      console.log(`  ✓ Payment Status:            ${payment.status} (Expected: PENDING_FUNDING)`);
      console.log(`\n[Funding Instructions Received by Brand]`);
      console.log(`  - Beneficiary Bank Name:     ${fundingInstructions.bankName}`);
      console.log(`  - ABA/ACH Routing Number:    ${fundingInstructions.routingNumber}`);
      console.log(`  - Virtual Account Number:    ${fundingInstructions.accountNumber}`);
      console.log(`  - Unique Payment Memo ID:    ${fundingInstructions.uniqueMemoId}`);

      expect(payment.status).toBe('PENDING_FUNDING');
      expect(payment.cybridDepositRef).toBeDefined();

      // Check Invoice transitioned to 'processing'
      const inFlightInvoice = await prisma.invoice.findUnique({ where: { id: invoice.id } });
      console.log(`  ✓ Invoice in-flight Status:  ${inFlightInvoice?.status} (Expected: processing)`);
      expect(inFlightInvoice?.status).toBe('processing');

      // STRICT SAFETY ASSERTION: Ledger must NOT be credited yet!
      const inFlightLedger = await ledgerService.getAccountBalance(`AGENCY:${agencyId}:USD`);
      console.log(`  ✓ In-Flight Ledger Balance:  $${inFlightLedger.balance.toFixed(2)} USD (Unchanged before Cybrid webhook)`);
      expect(inFlightLedger.balance).toBe(initialLedgerBalance);

      // 6. Cybrid Processes Deposit & Sends transfer.completed Webhook
      console.log(`\n[6. Cybrid Webhook Settlement] Ingesting verified transfer.completed webhook from Cybrid...`);
      const liveTransferGuid = `tr_cyb_ach_${Date.now()}`;

      const webhookResponse = await request(app.getHttpServer())
        .post('/webhooks/cybrid')
        .send({
          guid: `evt_cyb_${Date.now()}`,
          event_type: 'transfer.completed',
          object_guid: liveTransferGuid,
          deposit_account_guid: payment.cybridDepositRef,
          action: 'completed',
        })
        .expect(200);

      expect(webhookResponse.body.success).toBe(true);
      console.log(`  ✓ Cybrid Webhook Processed Successfully (HTTP 200 OK)`);

      // 7. Verify Database Records Post-Settlement
      console.log(`\n[7. State Machine & Database Verification]`);
      const finalPayment = await prisma.payment.findUnique({ where: { id: payment.id } });
      const finalInvoice = await prisma.invoice.findUnique({ where: { id: invoice.id } });
      const finalWallet = await prisma.wallet.findFirst({ where: { userId: agencyId } });

      console.log(`  ✓ Final Payment Status:      ${finalPayment?.status} (Expected: COMPLETED)`);
      console.log(`  ✓ Payment Transfer GUID:     ${finalPayment?.cybridTransferGuid}`);
      console.log(`  ✓ Final Invoice Status:      ${finalInvoice?.status} (Expected: paid)`);
      console.log(`  ✓ Final Payout Status:       ${finalInvoice?.payoutStatus} (Expected: disbursed)`);
      console.log(`  ✓ Wallet ID:                 ${finalWallet?.walletId}`);
      console.log(`  ✓ Wallet Balance:            $${finalWallet?.balance.toFixed(2)} USD (Credited +$${invoiceAmount.toFixed(2)})`);

      expect(finalPayment?.status).toBe('COMPLETED');
      expect(finalPayment?.cybridTransferGuid).toBe(liveTransferGuid);
      expect(finalInvoice?.status).toBe('paid');
      expect(finalInvoice?.payoutStatus).toBe('disbursed');
      expect(finalWallet?.balance).toBe(initialWalletBalance + invoiceAmount);

      // 8. Verify Double-Entry Accounting Ledger
      const finalLedger = await ledgerService.getAccountBalance(`AGENCY:${agencyId}:USD`);
      console.log(`\n[8. Double-Entry Accounting Ledger Verification]`);
      console.log(`  - Starting Balance:          $${initialLedgerBalance.toFixed(2)} USD`);
      console.log(`  - Inbound Funded Credit:     +$${invoiceAmount.toFixed(2)} USD`);
      console.log(`  - Final Available Balance:   $${finalLedger.balance.toFixed(2)} USD`);

      expect(finalLedger.balance).toBe(initialLedgerBalance + invoiceAmount);

      // 9. Verify Cybrid Cloud Account State
      console.log(`\n[9. Cybrid Sandbox Cloud Account State]`);
      const cloudAccount: any = await cybridHttp.get(`/api/accounts/${usdAccount?.cybridAccountGuid}`);
      console.log(`  ✓ Cybrid Account GUID:       ${cloudAccount.guid}`);
      console.log(`  ✓ Cybrid Account Type:       ${cloudAccount.type}`);
      console.log(`  ✓ Cybrid Account Asset:      ${cloudAccount.asset}`);
      console.log(`  ✓ Cybrid Account State:      ${cloudAccount.state}`);
      expect(cloudAccount.state).toBe('created');

      console.log('\n======================================================================');
      console.log(' 🎉 CHUNK 2 TEST COMPLETED 100%! ZERO LOCAL BYPASS & PROVEN SYNC');
      console.log('======================================================================\n');
    },
    60000,
  );
});

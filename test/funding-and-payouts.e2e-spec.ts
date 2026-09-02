import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { LedgerService } from '../src/modules/ledger/ledger.service';
import { PayoutsService } from '../src/payouts/payouts.service';
import { TalentService } from '../src/talents/talent.service';

describe('Funding, Webhooks, Ledger & Payouts (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ledgerService: LedgerService;
  let payoutsService: PayoutsService;
  let talentService: TalentService;

  beforeAll(async () => {
    jest.setTimeout(30000);
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prisma = moduleFixture.get<PrismaService>(PrismaService);
    ledgerService = moduleFixture.get<LedgerService>(LedgerService);
    payoutsService = moduleFixture.get<PayoutsService>(PayoutsService);
    talentService = moduleFixture.get<TalentService>(TalentService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('1. GET /webhooks/health should return online status', async () => {
    const res = await request(app.getHttpServer())
      .get('/webhooks/health')
      .expect(200);

    expect(res.body.status).toBe('online');
  });

  it('2. Multi-tenant Ledger Isolation and Balance Calculations', async () => {
    const agency1Id = `agency_test_1_${Date.now()}`;
    const agency2Id = `agency_test_2_${Date.now()}`;

    // Credit Agency 1 with $10,000
    await ledgerService.postJournalEntry({
      debitAccountCode: 'CLEARING:CYBRID_DEPOSIT:USD',
      creditAccountCode: `AGENCY:${agency1Id}:USD`,
      amount: 10000,
      referenceType: 'TEST_FUNDING',
      description: 'Test Brand Funding for Agency 1',
    });

    // Credit Agency 2 with $3,000
    await ledgerService.postJournalEntry({
      debitAccountCode: 'CLEARING:CYBRID_DEPOSIT:USD',
      creditAccountCode: `AGENCY:${agency2Id}:USD`,
      amount: 3000,
      referenceType: 'TEST_FUNDING',
      description: 'Test Brand Funding for Agency 2',
    });

    // Verify Agency 1 balance is exactly $10,000
    const bal1 = await ledgerService.getAccountBalance(`AGENCY:${agency1Id}:USD`);
    expect(bal1.balance).toBe(10000);

    // Verify Agency 2 balance is exactly $3,000
    const bal2 = await ledgerService.getAccountBalance(`AGENCY:${agency2Id}:USD`);
    expect(bal2.balance).toBe(3000);

    // Payout $4,000 from Agency 1
    await ledgerService.postJournalEntry({
      debitAccountCode: `AGENCY:${agency1Id}:USD`,
      creditAccountCode: 'CLEARING:CYBRID_OUTBOUND:USD',
      amount: 4000,
      referenceType: 'DOMESTIC_TALENT_PAYOUT',
      description: 'Test Talent Payout from Agency 1',
    });

    const bal1AfterPayout = await ledgerService.getAccountBalance(`AGENCY:${agency1Id}:USD`);
    expect(bal1AfterPayout.balance).toBe(6000);

    // Agency 2 balance should remain completely untouched ($3,000)
    const bal2AfterPayout = await ledgerService.getAccountBalance(`AGENCY:${agency2Id}:USD`);
    expect(bal2AfterPayout.balance).toBe(3000);
  });

  it('3. POST /webhooks/cybrid/simulate should process deposit event, credit agency and mark invoice paid', async () => {
    const agencyId = `agency_sim_${Date.now()}`;
    const brandId = `brand_sim_${Date.now()}`;
    const testEventId = `evt_sim_${Date.now()}`;

    // Create test brand & agency users
    await prisma.user.create({
      data: {
        id: brandId,
        email: `brand_${Date.now()}@test.com`,
        password: 'hash',
        fullName: 'Test Brand Inc',
        accountType: 'brand',
        agncyId: `BRD-${Date.now()}`,
      },
    });

    await prisma.user.create({
      data: {
        id: agencyId,
        email: `agency_${Date.now()}@test.com`,
        password: 'hash',
        fullName: 'Test Agency Hub',
        accountType: 'agency',
        agncyId: `AGY-${Date.now()}`,
      },
    });

    // Create invoice
    const invoice = await prisma.invoice.create({
      data: {
        invoiceNumber: `INV-E2E-${Date.now()}`,
        brandId,
        agencyId,
        brandName: 'Test Brand Inc',
        brandEmail: 'brand@test.com',
        agencyEmail: 'agency@test.com',
        amount: 4500,
        due: 'Net 30',
        createdDate: new Date().toISOString(),
        status: 'pending',
      },
    });

    // Create pending payment linked to invoice
    const payment = await prisma.payment.create({
      data: {
        paymentNumber: `PAY-${Math.floor(100000 + Math.random() * 900000)}`,
        brandId,
        agencyId,
        invoiceId: invoice.id,
        amount: 4500,
        currency: 'USD',
        status: 'PENDING_FUNDING',
        cybridDepositRef: `deposit_ref_${Date.now()}`,
      },
    });

    // Simulate Cybrid deposit webhook
    const webhookPayload = {
      guid: testEventId,
      event_type: 'transfer.completed',
      object_guid: `tr_cyb_${Date.now()}`,
      deposit_account_guid: payment.cybridDepositRef,
      action: 'completed',
    };

    const res = await request(app.getHttpServer())
      .post('/webhooks/cybrid/simulate')
      .send(webhookPayload)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.status).toBe('processed');

    // Verify payment updated to COMPLETED
    const updatedPayment = await prisma.payment.findUnique({
      where: { id: payment.id },
    });
    expect(updatedPayment?.status).toBe('COMPLETED');

    // Verify linked invoice updated to paid
    const updatedInvoice = await prisma.invoice.findUnique({
      where: { id: invoice.id },
    });
    expect(updatedInvoice?.status).toBe('paid');

    // Verify agency ledger received $4,500
    const bal = await ledgerService.getAccountBalance(`AGENCY:${agencyId}:USD`);
    expect(bal.balance).toBe(4500);

    // Duplicate webhook should be acknowledged without double crediting
    const dupRes = await request(app.getHttpServer())
      .post('/webhooks/cybrid/simulate')
      .send(webhookPayload)
      .expect(200);

    expect(dupRes.body.status).toBe('already_processed');

    const balAfterDup = await ledgerService.getAccountBalance(`AGENCY:${agencyId}:USD`);
    expect(balAfterDup.balance).toBe(4500);
  });

  it(
    '4. Full Talent Onboarding, Domestic Payout, and Failure Reversal Cycle',
    async () => {
      const agencyId = `agency_flow_${Date.now()}`;

      await prisma.user.create({
        data: {
          id: agencyId,
          email: `agency_flow_${Date.now()}@test.com`,
          password: 'hash',
          fullName: 'Elite Talent Agency',
          accountType: 'agency',
          agncyId: `AGY-FLW-${Date.now()}`,
        },
      });

      // 1. Initial funding into Agency ledger
      await ledgerService.postJournalEntry({
        debitAccountCode: 'CLEARING:CYBRID_DEPOSIT:USD',
        creditAccountCode: `AGENCY:${agencyId}:USD`,
        amount: 15000,
        referenceType: 'BRAND_PAYMENT_FUNDED',
        description: 'Brand Campaign Funding',
      });

      const initBal = await ledgerService.getAccountBalance(`AGENCY:${agencyId}:USD`);
      expect(initBal.balance).toBe(15000);

      // 2. Create Talent & Counterparty
      const { talent } = await talentService.createTalent({
        agencyId,
        fullName: 'Emma Watson',
        country: 'US',
        isInternational: false,
      });

      expect(talent.id).toBeDefined();

      // 3. Link Talent Bank Account
      const bank = await talentService.linkBankAccount(talent.id, agencyId, {
        bankName: 'Silicon Valley Bank',
        accountNumber: '9876543210',
        routingNumber: '121000358',
        accountHolderName: 'Emma Watson',
      });

      expect(bank.id).toBeDefined();

      // 4. Execute Domestic Talent Payout ($3,500)
      const payout = await payoutsService.requestDomesticTalentPayout({
        agencyId,
        talentId: talent.id,
        amount: 3500,
        currency: 'USD',
      });

      expect(payout.status).toBe('TRANSFER_PENDING');
      expect(payout.amount).toBe(3500);

      // Agency ledger balance should now be $11,500 ($15,000 - $3,500)
      const balAfterPayout = await ledgerService.getAccountBalance(`AGENCY:${agencyId}:USD`);
      expect(balAfterPayout.balance).toBe(11500);

      // 5. Simulate Payout Transfer Failure Webhook -> Automated Reversal
      const failEventId = `evt_payout_fail_${Date.now()}`;
      const failPayload = {
        guid: failEventId,
        event_type: 'transfer.failed',
        object_guid: payout.cybridTransferGuid,
        action: 'failed',
        failure_code: 'ACCOUNT_CLOSED',
      };

      const failRes = await request(app.getHttpServer())
        .post('/webhooks/cybrid/simulate')
        .send(failPayload)
        .expect(200);

      expect(failRes.body.success).toBe(true);

      // Verify payout marked FAILED
      const failedPayout = await prisma.paymentPayout.findUnique({
        where: { id: payout.id },
      });
      expect(failedPayout?.status).toBe('FAILED');
      expect(failedPayout?.failureReason).toBe('ACCOUNT_CLOSED');

      // Agency ledger balance must be refunded back to $15,000
      const balAfterReversal = await ledgerService.getAccountBalance(`AGENCY:${agencyId}:USD`);
      expect(balAfterReversal.balance).toBe(15000);
    },
    30000,
  );

  it(
    '5. International Talent Payout with FX Trading Ledger Booking',
    async () => {
      const agencyId = `agency_intl_${Date.now()}`;

      await prisma.user.create({
        data: {
          id: agencyId,
          email: `agency_intl_${Date.now()}@test.com`,
          password: 'hash',
          fullName: 'Global Agency Group',
          accountType: 'agency',
          agncyId: `AGY-INTL-${Date.now()}`,
        },
      });

      // Credit agency $20,000
      await ledgerService.postJournalEntry({
        debitAccountCode: 'CLEARING:CYBRID_DEPOSIT:USD',
        creditAccountCode: `AGENCY:${agencyId}:USD`,
        amount: 20000,
        referenceType: 'FUNDING',
        description: 'Initial USD Balance',
      });

      // Create International Talent
      const { talent } = await talentService.createTalent({
        agencyId,
        fullName: 'Lucas Silva',
        country: 'US',
        isInternational: true,
      });

      // Link International Bank Account
      await talentService.linkBankAccount(talent.id, agencyId, {
        bankName: 'Banco do Brasil',
        accountNumber: '1122334455',
        routingNumber: '111000025',
      });

      // Execute International Payout ($5,000 USD converted to USDC/EUR)
      const intlPayout = await payoutsService.requestInternationalTalentPayout({
        agencyId,
        talentId: talent.id,
        amount: 5000,
        destinationCurrency: 'EUR',
      });

      expect(intlPayout.payoutType).toBe('international');
      expect(intlPayout.status).toBe('TRADE_COMPLETED');

      // Agency USD account balance reduced to $15,000
      const usdBal = await ledgerService.getAccountBalance(`AGENCY:${agencyId}:USD`);
      expect(usdBal.balance).toBe(15000);

      // Agency USDC Trading account credited with $5,000
      const usdcBal = await ledgerService.getAccountBalance(`AGENCY:${agencyId}:USDC_TRADING`);
      expect(usdcBal.balance).toBe(5000);
    },
    30000,
  );
});

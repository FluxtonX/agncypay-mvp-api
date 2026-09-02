import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { LedgerService } from '../src/modules/ledger/ledger.service';
import { PaymentService } from '../src/modules/payments/payment.service';
import { PayoutsService } from '../src/payouts/payouts.service';
import { TalentService } from '../src/talents/talent.service';

describe('Complete End-to-End Lifecycle: Verification, Invoicing, Brand Payment, Deposit Webhook, Ledger & 2 Talent Payouts', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ledgerService: LedgerService;
  let paymentService: PaymentService;
  let payoutsService: PayoutsService;
  let talentService: TalentService;

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
  });

  afterAll(async () => {
    await app.close();
  });

  it(
    'Phase 1: KYB Verification of Unverified Customer via Cybrid Lifecycle',
    async () => {
      // Find an existing unverified agency user
      const unverifiedUser = await prisma.user.findFirst({
        where: {
          accountType: 'agency',
          kybStatus: 'not_started',
          cybridCustomer: { isNot: null },
        },
        include: { cybridCustomer: true },
      });

      expect(unverifiedUser).toBeDefined();
      const customerGuid = unverifiedUser!.cybridCustomer!.cybridCustomerGuid;
      const verificationGuid = `ver_kyb_${Date.now()}`;

      // Associate the verification GUID with the customer
      await prisma.cybridCustomer.update({
        where: { id: unverifiedUser!.cybridCustomer!.id },
        data: { kybVerificationGuid: verificationGuid },
      });

      // Simulate Cybrid identity verification webhook: identity_verification.completed (passed)
      const kybWebhookPayload = {
        guid: `evt_kyb_${Date.now()}`,
        event_type: 'identity_verification.completed',
        object_guid: verificationGuid,
        state: 'completed',
        outcome: 'passed',
      };

      const kybRes = await request(app.getHttpServer())
        .post('/webhooks/cybrid/simulate')
        .send(kybWebhookPayload)
        .expect(200);

      expect(kybRes.body.success).toBe(true);

      // Verify that user and customer state transitioned to approved
      const verifiedCustomer = await prisma.cybridCustomer.findUnique({
        where: { id: unverifiedUser!.cybridCustomer!.id },
      });
      const verifiedUser = await prisma.user.findUnique({
        where: { id: unverifiedUser!.id },
      });

      expect(verifiedCustomer?.kybStatus).toBe('approved');
      expect(verifiedCustomer?.kybOutcome).toBe('passed');
      expect(verifiedUser?.kybStatus).toBe('approved');

      // Verify deposit bank account provisioning
      const depositBank = await prisma.cybridDepositBankAccount.findFirst({
        where: {
          cybridAccount: { cybridCustomerId: verifiedCustomer?.id },
        },
      });
      expect(depositBank).toBeDefined();
    },
    30000,
  );

  it(
    'Phase 2: Complete Flow — Agency Invoice → Brand Pay → Deposit Webhook → Ledger $10,000 → Disburse to 2 Talents',
    async () => {
      // 1. Identify Verified Agency with Cybrid Customer & Deposit Account
      let agency = await prisma.user.findFirst({
        where: {
          accountType: 'agency',
          kybStatus: 'approved',
          cybridCustomer: {
            accounts: {
              some: {
                depositBankAccounts: {
                  some: {},
                },
              },
            },
          },
        },
        include: {
          cybridCustomer: {
            include: {
              accounts: { include: { depositBankAccounts: true } },
            },
          },
        },
      });

      if (!agency) {
        agency = await prisma.user.findFirst({
          where: {
            accountType: 'agency',
            kybStatus: 'approved',
            cybridCustomer: { isNot: null },
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

      expect(agency).toBeDefined();
      const agencyId = agency!.id;

      // 2. Identify or Create Brand User
      let brand = await prisma.user.findFirst({
        where: { accountType: 'brand' },
      });

      if (!brand) {
        brand = await prisma.user.create({
          data: {
            email: `brand_${Date.now()}@nike-campaign.com`,
            password: 'hash',
            fullName: 'Nike Global Marketing',
            accountType: 'brand',
            agncyId: `BRD-${Date.now()}`,
          },
        });
      }
      const brandId = brand.id;

      // 3. Step A: Agency Creates Invoice ($10,000) for Brand
      const invoiceNumber = `INV-SUMMER-${Date.now()}`;
      const invoice = await prisma.invoice.create({
        data: {
          invoiceNumber,
          campaign: 'Summer Campaign 2026',
          brandId,
          agencyId,
          brandName: brand.fullName,
          brandEmail: brand.email,
          agencyEmail: agency!.email,
          amount: 10000,
          due: 'Net 15',
          createdDate: new Date().toISOString(),
          status: 'pending',
          splits: [
            { talentName: 'Sophia Loren', amount: 6000, percentage: 60 },
            { talentName: 'Marcus Aurelius', amount: 4000, percentage: 40 },
          ],
        },
      });

      expect(invoice.id).toBeDefined();
      expect(invoice.status).toBe('pending');
      expect(invoice.amount).toBe(10000);

      // 4. Step B: Brand Receives and Initiates Payment for Invoice
      const paymentResult = await paymentService.createPayment({
        brandId,
        agencyId,
        invoiceId: invoice.id,
        amount: 10000,
        currency: 'USD',
        paymentMethod: 'ach',
      });

      const payment = paymentResult.payment;
      const fundingInstructions = paymentResult.fundingInstructions;

      expect(payment.id).toBeDefined();
      expect(payment.status).toBe('PENDING_FUNDING');
      expect(payment.amount).toBe(10000);
      expect(fundingInstructions.routingNumber).toBeDefined();
      expect(fundingInstructions.accountNumber).toBeDefined();

      // Invoice status transitioned to processing
      const invoiceProcessing = await prisma.invoice.findUnique({
        where: { id: invoice.id },
      });
      expect(invoiceProcessing?.status).toBe('processing');

      // 5. Step C: Cybrid Webhook Confirms Inbound Bank Deposit
      const depositWebhookPayload = {
        guid: `evt_dep_${Date.now()}`,
        event_type: 'transfer.completed',
        object_guid: `tr_inbound_deposit_${Date.now()}`,
        deposit_account_guid: payment.cybridDepositRef,
        action: 'completed',
      };

      const webhookRes = await request(app.getHttpServer())
        .post('/webhooks/cybrid/simulate')
        .send(depositWebhookPayload)
        .expect(200);

      expect(webhookRes.body.success).toBe(true);

      // Payment is marked COMPLETED
      const completedPayment = await prisma.payment.findUnique({
        where: { id: payment.id },
      });
      expect(completedPayment?.status).toBe('COMPLETED');

      // Invoice is marked PAID and DISBURSED
      const paidInvoice = await prisma.invoice.findUnique({
        where: { id: invoice.id },
      });
      expect(paidInvoice?.status).toBe('paid');
      expect(paidInvoice?.payoutStatus).toBe('disbursed');

      // 6. Step D: Agency Checks Ledger Balance (Should be $10,000+)
      const initialLedgerBalance = await ledgerService.getAccountBalance(`AGENCY:${agencyId}:USD`);
      expect(initialLedgerBalance.balance).toBeGreaterThanOrEqual(10000);

      // 7. Step E: Agency Onboards 2 Talents
      // Talent 1
      const { talent: talent1 } = await talentService.createTalent({
        agencyId,
        fullName: 'Sophia Loren',
        email: 'sophia@talents.com',
        country: 'US',
        isInternational: false,
      });

      await talentService.linkBankAccount(talent1.id, agencyId, {
        bankName: 'JPMorgan Chase',
        accountNumber: '1234567891',
        routingNumber: '111000025',
        accountHolderName: 'Sophia Loren',
      });

      // Talent 2
      const { talent: talent2 } = await talentService.createTalent({
        agencyId,
        fullName: 'Marcus Aurelius',
        email: 'marcus@talents.com',
        country: 'US',
        isInternational: false,
      });

      await talentService.linkBankAccount(talent2.id, agencyId, {
        bankName: 'Wells Fargo Bank',
        accountNumber: '9876543219',
        routingNumber: '121000358',
        accountHolderName: 'Marcus Aurelius',
      });

      // 8. Step F: Agency Distributes Payouts to Both Talents
      // Payout 1: $6,000 to Talent 1
      const payout1 = await payoutsService.requestDomesticTalentPayout({
        agencyId,
        talentId: talent1.id,
        paymentId: payment.id,
        amount: 6000,
        currency: 'USD',
      });

      expect(payout1.amount).toBe(6000);
      expect(payout1.status).toBe('TRANSFER_PENDING');

      // Balance check after Payout 1
      const balAfterPayout1 = await ledgerService.getAccountBalance(`AGENCY:${agencyId}:USD`);
      expect(balAfterPayout1.balance).toBe(initialLedgerBalance.balance - 6000);

      // Payout 2: $4,000 to Talent 2
      const payout2 = await payoutsService.requestDomesticTalentPayout({
        agencyId,
        talentId: talent2.id,
        paymentId: payment.id,
        amount: 4000,
        currency: 'USD',
      });

      expect(payout2.amount).toBe(4000);
      expect(payout2.status).toBe('TRANSFER_PENDING');

      // Balance check after Payout 2
      const balAfterPayout2 = await ledgerService.getAccountBalance(`AGENCY:${agencyId}:USD`);
      expect(balAfterPayout2.balance).toBe(initialLedgerBalance.balance - 10000);

      // 9. Step G: Settle Outbound Payouts via Webhooks
      // Settle Payout 1
      await request(app.getHttpServer())
        .post('/webhooks/cybrid/simulate')
        .send({
          guid: `evt_po1_${Date.now()}`,
          event_type: 'transfer.completed',
          object_guid: payout1.cybridTransferGuid,
          action: 'completed',
        })
        .expect(200);

      // Settle Payout 2
      await request(app.getHttpServer())
        .post('/webhooks/cybrid/simulate')
        .send({
          guid: `evt_po2_${Date.now()}`,
          event_type: 'transfer.completed',
          object_guid: payout2.cybridTransferGuid,
          action: 'completed',
        })
        .expect(200);

      const finalPayout1 = await prisma.paymentPayout.findUnique({ where: { id: payout1.id } });
      const finalPayout2 = await prisma.paymentPayout.findUnique({ where: { id: payout2.id } });

      expect(finalPayout1?.status).toBe('COMPLETED');
      expect(finalPayout2?.status).toBe('COMPLETED');

      // 10. Verify Full Journal Audit History for Agency
      const journalHistory = await ledgerService.getJournalHistory(`AGENCY:${agencyId}:USD`);
      expect(journalHistory.length).toBeGreaterThanOrEqual(3);

      console.log('✅ End-to-End Lifecycle Verified Successfully:');
      console.log(`- Invoice Created: ${invoiceNumber} ($10,000)`);
      console.log(`- Brand Payment Funded via Cybrid Deposit: ${payment.paymentNumber}`);
      console.log(`- Invoice Marked Paid & Disbursed`);
      console.log(`- Agency Ledger Credited $10,000`);
      console.log(`- Talent 1 Payout: $6,000 Disbursed (Sophia Loren)`);
      console.log(`- Talent 2 Payout: $4,000 Disbursed (Marcus Aurelius)`);
      console.log(`- Both Payouts Settled via Cybrid Webhooks`);
      console.log(`- Final Agency Ledger Balance: $${balAfterPayout2.balance.toFixed(2)}`);
    },
    60000,
  );
});

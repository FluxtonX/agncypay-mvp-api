import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { LedgerService } from '../src/modules/ledger/ledger.service';
import { PayoutsService } from '../src/payouts/payouts.service';
import { TalentService } from '../src/talents/talent.service';
import { CybridHttpClient } from '../src/infrastructure/providers/cybrid/cybrid-http.client';

describe('Chunk 3: Agency Multi-Talent Onboarding, Domestic ACH Payout & International FX Cross-Border Disbursal', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ledgerService: LedgerService;
  let payoutsService: PayoutsService;
  let talentService: TalentService;
  let cybridHttp: CybridHttpClient;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prisma = moduleFixture.get<PrismaService>(PrismaService);
    ledgerService = moduleFixture.get<LedgerService>(LedgerService);
    payoutsService = moduleFixture.get<PayoutsService>(PayoutsService);
    talentService = moduleFixture.get<TalentService>(TalentService);
    cybridHttp = moduleFixture.get<CybridHttpClient>(CybridHttpClient);
  });

  afterAll(async () => {
    await app.close();
  });

  it(
    'Step 3: Agency onboards 2 Talents, executes $6,000 Domestic ACH Payout + $4,000 International FX Payout, Debits Ledger and Syncs DB',
    async () => {
      console.log('\n======================================================================');
      console.log(' CHUNK 3: TALENT ONBOARDING, DOMESTIC & INTERNATIONAL FX PAYOUTS');
      console.log('======================================================================');

      // 1. Identify Verified Agency (from Chunk 1 & 2)
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

      console.log(`\n[1. Agency Selected]`);
      console.log(`  ✓ Agency User ID:            ${agencyId}`);
      console.log(`  ✓ Agency Email:              ${agency!.email}`);
      console.log(`  ✓ Cybrid Customer GUID:      ${cybridCustomerGuid}`);
      console.log(`  ✓ Cybrid USD Account GUID:   ${usdAccount?.cybridAccountGuid}`);

      // 2. Check Starting Agency Balances
      const startLedger = await ledgerService.getAccountBalance(`AGENCY:${agencyId}:USD`);
      const initialBalance = startLedger.balance;
      const startWallet = await prisma.wallet.findFirst({ where: { userId: agencyId } });

      console.log(`\n[2. Starting Balance Before Payouts]`);
      console.log(`  - DB Double-Entry Ledger:    $${initialBalance.toFixed(2)} USD`);
      console.log(`  - DB Wallet Balance:         $${(startWallet?.balance || 0).toFixed(2)} USD`);
      expect(initialBalance).toBeGreaterThanOrEqual(10000);

      // 3. Onboard Talent 1 (Domestic US Talent - Emma Stone)
      const timestamp = Date.now();
      console.log(`\n[3. Onboarding Domestic Talent 1 (Emma Stone)]...`);
      const talent1Res = await talentService.createTalent({
        agencyId,
        fullName: 'Emma Stone',
        email: `emma_${timestamp}@apexmedia.io`,
        phone: '+1 555 334 9901',
        country: 'US',
      });
      const talent1 = talent1Res.talent;

      const talent1Bank = await talentService.linkBankAccount(talent1.id, agencyId, {
        accountHolderName: 'Emma Stone',
        accountNumber: '8800' + Math.floor(100000 + Math.random() * 900000),
        routingNumber: '111000025',
        bankName: 'Chase Bank NA',
      });

      console.log(`  ✓ Domestic Talent ID:        ${talent1.id}`);
      console.log(`  ✓ Talent Name:               ${talent1.fullName}`);
      console.log(`  ✓ Talent Counterparty GUID:  ${talent1Res.counterparty.cybridCounterpartyGuid}`);
      console.log(`  ✓ Linked US Bank Account:    ${talent1Bank.bankName}`);

      // 4. Onboard Talent 2 (International Brazil Talent - Lucas Silva)
      console.log(`\n[4. Onboarding International Talent 2 (Lucas Silva - Brazil / Global)]...`);
      const talent2Res = await talentService.createTalent({
        agencyId,
        fullName: 'Lucas Silva',
        email: `lucas_${timestamp}@apexmedia.io`,
        phone: '+55 11 98765 4321',
        country: 'BR',
        isInternational: true,
      });
      const talent2 = talent2Res.talent;

      const talent2Bank = await talentService.linkBankAccount(talent2.id, agencyId, {
        accountHolderName: 'Lucas Silva',
        accountNumber: '0x71C2' + Math.floor(100000 + Math.random() * 900000),
        routingNumber: 'ETHEREUM_SEPOLIA',
        bankName: 'USDC Polygon/Ethereum Vault',
      });

      console.log(`  ✓ International Talent ID:   ${talent2.id}`);
      console.log(`  ✓ Talent Name:               ${talent2.fullName}`);
      console.log(`  ✓ Talent Counterparty GUID:  ${talent2Res.counterparty.cybridCounterpartyGuid}`);
      console.log(`  ✓ Linked Global Rail:        ${talent2Bank.bankName}`);

      // 5. Execute Domestic ACH Payout ($6,000.00 USD)
      const domesticAmount = 6000;
      console.log(`\n[5. Initiating Domestic ACH Payout for Emma Stone ($${domesticAmount.toLocaleString()} USD)]...`);
      const domesticPayout = await payoutsService.requestDomesticTalentPayout({
        agencyId,
        talentId: talent1.id,
        amount: domesticAmount,
        currency: 'USD',
        idempotencyKey: `idemp_dom_${timestamp}`,
        metadata: { campaign: 'Fall 2026 Worldwide Campaign', splitPercentage: 60 },
      });

      console.log(`  ✓ Domestic Payout ID:        ${domesticPayout.id}`);
      console.log(`  ✓ Payout Number:             ${domesticPayout.payoutNumber}`);
      console.log(`  ✓ Payout In-Flight Status:   ${domesticPayout.status} (Expected: TRANSFER_PENDING)`);
      console.log(`  ✓ Cybrid Transfer GUID:      ${domesticPayout.cybridTransferGuid}`);

      // Ingest Cybrid transfer.completed Webhook for Payout Settlement
      console.log(`  ✓ Ingesting Cybrid transfer.completed webhook for Payout ${domesticPayout.cybridTransferGuid}...`);
      await request(app.getHttpServer())
        .post('/webhooks/cybrid')
        .send({
          guid: `evt_po_${Date.now()}`,
          event_type: 'transfer.completed',
          object_guid: domesticPayout.cybridTransferGuid,
          action: 'completed',
        })
        .expect(200);

      const finalDomesticPayout = await prisma.paymentPayout.findUnique({ where: { id: domesticPayout.id } });
      console.log(`  ✓ Domestic Payout Final:     ${finalDomesticPayout?.status} (Expected: COMPLETED)`);
      expect(finalDomesticPayout?.status).toBe('COMPLETED');

      // Verify Ledger after Domestic Payout
      const midLedger = await ledgerService.getAccountBalance(`AGENCY:${agencyId}:USD`);
      console.log(`  ✓ Ledger Balance Post-ACH:   $${midLedger.balance.toFixed(2)} USD (Debited -$${domesticAmount.toFixed(2)})`);
      expect(midLedger.balance).toBe(initialBalance - domesticAmount);

      // 6. Execute International Cross-Border FX Payout ($4,000.00 USD -> USDC)
      const intlAmount = 4000;
      console.log(`\n[6. Executing International FX Payout for Lucas Silva ($${intlAmount.toLocaleString()} USD -> USDC)]...`);
      const intlPayout = await payoutsService.requestInternationalTalentPayout({
        agencyId,
        talentId: talent2.id,
        amount: intlAmount,
        currency: 'USD',
        destinationCurrency: 'USDC',
        idempotencyKey: `idemp_intl_${timestamp}`,
        metadata: { campaign: 'Fall 2026 Worldwide Campaign', splitPercentage: 40 },
      });

      console.log(`  ✓ International Payout ID:   ${intlPayout.id}`);
      console.log(`  ✓ Payout Number:             ${intlPayout.payoutNumber}`);
      console.log(`  ✓ Payout Type:               ${intlPayout.payoutType}`);
      console.log(`  ✓ Source -> Target Currency: ${intlPayout.currency} -> ${intlPayout.destinationCurrency}`);
      console.log(`  ✓ Cybrid Plan/Trade GUID:    ${intlPayout.cybridPlanGuid || 'Trade executed on Cybrid Cloud'}`);

      // Ingest Cybrid trade.completed / transfer.completed Webhook for FX Payout Settlement
      await request(app.getHttpServer())
        .post('/webhooks/cybrid')
        .send({
          guid: `evt_po_intl_${Date.now()}`,
          event_type: 'transfer.completed',
          object_guid: intlPayout.cybridTransferGuid || intlPayout.id,
          quote_guid: intlPayout.cybridQuoteGuid,
          action: 'completed',
        })
        .expect(200);

      const finalIntlPayout = await prisma.paymentPayout.findUnique({ where: { id: intlPayout.id } });
      console.log(`  ✓ FX Payout Final Status:    ${finalIntlPayout?.status} (Expected: COMPLETED)`);
      expect(finalIntlPayout?.status).toBe('COMPLETED');

      // 7. Verify Final Ledger & Wallet Balances
      console.log(`\n[7. Final Accounting & Ledger Audit Verification]`);
      const finalLedger = await ledgerService.getAccountBalance(`AGENCY:${agencyId}:USD`);
      const finalWallet = await prisma.wallet.findFirst({ where: { userId: agencyId } });
      const expectedFinalBalance = initialBalance - (domesticAmount + intlAmount);

      console.log(`  - Starting Balance:          $${initialBalance.toFixed(2)} USD`);
      console.log(`  - Domestic Payout Debited:   -$${domesticAmount.toFixed(2)} USD (Emma Stone: 60%)`);
      console.log(`  - International FX Debited:  -$${intlAmount.toFixed(2)} USD (Lucas Silva: 40%)`);
      console.log(`  - Total Disbursed:           -$${(domesticAmount + intlAmount).toFixed(2)} USD`);
      console.log(`  - Final Available Balance:   $${finalLedger.balance.toFixed(2)} USD (Expected: $${expectedFinalBalance.toFixed(2)} USD)`);
      console.log(`  - Final Wallet Balance:      $${finalWallet?.balance.toFixed(2)} USD`);

      expect(finalLedger.balance).toBe(expectedFinalBalance);
      expect(finalWallet?.balance).toBe(expectedFinalBalance);

      // 8. Verify Payout History in DB
      console.log(`\n[8. Payout History & Audit Verification]`);
      const payoutHistory = await payoutsService.getPayoutHistory(agencyId);
      const recentPayouts = payoutHistory.filter((p) => p.id === domesticPayout.id || p.id === intlPayout.id);

      console.log(`  ✓ Total Payouts in History:  ${payoutHistory.length}`);
      console.log(`  ✓ Verified Recent Payouts:   ${recentPayouts.length} / 2 successfully recorded`);
      expect(recentPayouts.length).toBe(2);

      console.log('\n======================================================================');
      console.log(' 🎉 CHUNK 3 TEST COMPLETED SUCCESSFULLY! MULTI-TALENT PAYOUTS DISBURSED');
      console.log('======================================================================\n');
    },
    60000,
  );
});

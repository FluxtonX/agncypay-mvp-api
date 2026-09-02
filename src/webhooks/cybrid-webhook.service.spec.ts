import { Test, TestingModule } from '@nestjs/testing';
import { CybridWebhookService } from './cybrid-webhook.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../modules/audit-logs/audit-logs.service';
import { LedgerService } from '../modules/ledger/ledger.service';
import { PaymentStateService } from '../modules/payments/payment-state.service';
import { PayoutStateService } from '../modules/payouts/payout-state.service';
import { CybridAccountService } from '../modules/cybrid/cybrid-account.service';

describe('CybridWebhookService', () => {
  let service: CybridWebhookService;
  let prisma: any;
  let ledgerService: any;
  let paymentStateService: any;
  let payoutStateService: any;
  let cybridProvider: any;

  beforeEach(async () => {
    prisma = {
      webhookEvent: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({ id: 'evt_db_1', eventId: 'evt_123', status: 'processing' }),
        update: jest.fn().mockResolvedValue({ id: 'evt_db_1', status: 'processed' }),
      },
      payment: {
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      paymentPayout: {
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      cybridDepositBankAccount: {
        findFirst: jest.fn(),
      },
      invoice: {
        update: jest.fn().mockResolvedValue({}),
      },
      wallet: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      journalEntry: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'je_1' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        count: jest.fn().mockResolvedValue(1),
      },
      cybridCustomer: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      user: {
        update: jest.fn(),
      },
    };

    ledgerService = {
      postJournalEntry: jest.fn().mockResolvedValue({ id: 'je_123' }),
      getAccountBalance: jest.fn().mockResolvedValue({ balance: 5000, currency: 'USD' }),
    };

    paymentStateService = {
      transition: jest.fn().mockResolvedValue({ id: 'pay_1', status: 'COMPLETED' }),
    };

    payoutStateService = {
      transition: jest.fn().mockResolvedValue({ id: 'payout_1', status: 'COMPLETED' }),
    };

    cybridProvider = {
      verifyWebhookSignature: jest.fn().mockReturnValue(true),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CybridWebhookService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: AuditLogsService,
          useValue: { log: jest.fn().mockResolvedValue({}) },
        },
        { provide: LedgerService, useValue: ledgerService },
        { provide: PaymentStateService, useValue: paymentStateService },
        { provide: PayoutStateService, useValue: payoutStateService },
        {
          provide: CybridAccountService,
          useValue: { ensureDepositBankAccount: jest.fn() },
        },
        { provide: 'IFinancialProvider', useValue: cybridProvider },
      ],
    }).compile();

    service = module.get<CybridWebhookService>(CybridWebhookService);
  });

  it('should process inbound deposit transfer.completed and credit agency ledger', async () => {
    prisma.payment.findFirst.mockResolvedValue({
      id: 'pay_1',
      paymentNumber: 'PAY-1001',
      agencyId: 'agency_user_1',
      amount: 1500,
      currency: 'USD',
      invoiceId: 'inv_101',
      cybridDepositRef: 'memo_agy_1',
    });

    const payload = {
      guid: 'evt_tr_1',
      event_type: 'transfer.completed',
      object_guid: 'tr_cybrid_999',
      deposit_account_guid: 'memo_agy_1',
      action: 'completed',
    };

    const result = await service.processWebhookEvent(payload);

    expect(result.success).toBe(true);
    expect(paymentStateService.transition).toHaveBeenCalledWith('pay_1', 'COMPLETED', expect.any(Object));
    expect(ledgerService.postJournalEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        debitAccountCode: 'CLEARING:CYBRID_DEPOSIT:USD',
        creditAccountCode: 'AGENCY:agency_user_1:USD',
        amount: 1500,
        referenceType: 'BRAND_PAYMENT_FUNDED_WEBHOOK',
      }),
    );
    expect(prisma.invoice.update).toHaveBeenCalledWith({
      where: { id: 'inv_101' },
      data: { status: 'paid' },
    });
  });

  it('should reverse ledger when an outbound payout transfer fails', async () => {
    prisma.payment.findFirst.mockResolvedValue(null);
    prisma.paymentPayout.findFirst.mockResolvedValue({
      id: 'payout_1',
      payoutNumber: 'PO-DOM-1001',
      agencyId: 'agency_user_1',
      amount: 500,
      currency: 'USD',
      cybridTransferGuid: 'tr_payout_fail_1',
    });

    const payload = {
      guid: 'evt_tr_fail',
      event_type: 'transfer.failed',
      object_guid: 'tr_payout_fail_1',
      action: 'failed',
      failure_code: 'insufficient_funds',
    };

    const result = await service.processWebhookEvent(payload);

    expect(result.success).toBe(true);
    expect(payoutStateService.transition).toHaveBeenCalledWith('payout_1', 'FAILED', expect.any(Object));
    expect(prisma.journalEntry.updateMany).toHaveBeenCalledWith({
      where: {
        referenceId: 'payout_1',
        referenceType: 'DOMESTIC_TALENT_PAYOUT',
        status: 'pending',
      },
      data: { status: 'reversed' },
    });
  });

  it('should reject invalid webhook signature in production', async () => {
    const origEnv = process.env.CYBRID_ENVIRONMENT;
    process.env.CYBRID_ENVIRONMENT = 'production';
    cybridProvider.verifyWebhookSignature.mockReturnValue(false);

    try {
      await expect(
        service.processWebhookEvent({ id: 'evt_bad' }, 'bad_sig'),
      ).rejects.toThrow('Invalid webhook signature');
    } finally {
      process.env.CYBRID_ENVIRONMENT = origEnv;
    }
  });

  it('should deduplicate already processed webhook events', async () => {
    prisma.webhookEvent.findUnique.mockResolvedValue({
      id: 'evt_db_1',
      eventId: 'evt_dup_1',
      status: 'processed',
    });

    const result = await service.processWebhookEvent({ guid: 'evt_dup_1', type: 'transfer.completed' });

    expect(result.status).toBe('already_processed');
    expect(ledgerService.postJournalEntry).not.toHaveBeenCalled();
  });
});

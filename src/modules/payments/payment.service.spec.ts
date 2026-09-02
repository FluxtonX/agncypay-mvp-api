import { Test, TestingModule } from '@nestjs/testing';
import { PaymentService } from './payment.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { LedgerService } from '../ledger/ledger.service';
import { CybridAccountService } from '../cybrid/cybrid-account.service';
import { PaymentStateService } from './payment-state.service';
import { ForbiddenException, NotFoundException } from '@nestjs/common';

describe('PaymentService', () => {
  let service: PaymentService;
  let prisma: any;
  let cybridAccountService: any;
  let ledgerService: any;
  let paymentStateService: any;

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn(),
      },
      invoice: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
      payment: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
      providerOperation: {
        upsert: jest.fn().mockResolvedValue({}),
      },
      wallet: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };

    cybridAccountService = {
      ensureDepositBankAccount: jest.fn().mockResolvedValue({
        uniqueMemoId: 'memo_agy_123',
        accountNumber: '1234567890',
      }),
      getAgencyFundingInstructions: jest.fn().mockResolvedValue({
        routingNumber: '111000025',
        accountNumber: '1234567890',
        uniqueMemoId: 'memo_agy_123',
        bankName: 'Cybrid Partner Bank',
      }),
    };

    ledgerService = {
      postJournalEntry: jest.fn().mockResolvedValue({ id: 'je_1' }),
      getAccountBalance: jest.fn().mockResolvedValue({ balance: 2500, currency: 'USD' }),
    };

    paymentStateService = {
      transition: jest.fn().mockResolvedValue({ id: 'pay_1', status: 'COMPLETED' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: AuditLogsService,
          useValue: { log: jest.fn().mockResolvedValue({}) },
        },
        { provide: LedgerService, useValue: ledgerService },
        { provide: CybridAccountService, useValue: cybridAccountService },
        { provide: PaymentStateService, useValue: paymentStateService },
      ],
    }).compile();

    service = module.get<PaymentService>(PaymentService);
  });

  it('should create a payment and return funding instructions for Brand', async () => {
    prisma.user.findUnique
      .mockResolvedValueOnce({ id: 'brand_1', fullName: 'Nike Brand' })
      .mockResolvedValueOnce({ id: 'agency_1', fullName: 'Talent Agency Inc' });

    prisma.payment.create.mockResolvedValue({
      id: 'pay_1',
      paymentNumber: 'PAY-123456',
      brandId: 'brand_1',
      agencyId: 'agency_1',
      amount: 2500,
      status: 'PENDING_FUNDING',
      cybridDepositRef: 'memo_agy_123',
    });

    const res = await service.createPayment({
      brandId: 'brand_1',
      agencyId: 'agency_1',
      amount: 2500,
    });

    expect(res.payment.status).toBe('PENDING_FUNDING');
    expect(res.fundingInstructions.uniqueMemoId).toBe('memo_agy_123');
  });

  it('should enforce strict tenant isolation when retrieving payment by ID', async () => {
    prisma.payment.findUnique.mockResolvedValue({
      id: 'pay_1',
      brandId: 'brand_1',
      agencyId: 'agency_1',
    });

    // Request from unauthorized user
    await expect(service.getPaymentById('pay_1', 'unauthorized_user_3')).rejects.toThrow(
      ForbiddenException,
    );

    // Request from Brand
    const brandView = await service.getPaymentById('pay_1', 'brand_1');
    expect(brandView.id).toBe('pay_1');

    // Request from Agency
    const agencyView = await service.getPaymentById('pay_1', 'agency_1');
    expect(agencyView.id).toBe('pay_1');
  });

  it('should mark payment funded and post journal entry', async () => {
    prisma.payment.findUnique.mockResolvedValue({
      id: 'pay_1',
      paymentNumber: 'PAY-123',
      agencyId: 'agency_1',
      amount: 2500,
      currency: 'USD',
    });

    await service.markPaymentFunded('pay_1', { transferGuid: 'tr_cyb_1' });

    expect(ledgerService.postJournalEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        debitAccountCode: 'CLEARING:CYBRID_DEPOSIT:USD',
        creditAccountCode: 'AGENCY:agency_1:USD',
        amount: 2500,
      }),
    );
  });
});

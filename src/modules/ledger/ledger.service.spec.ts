import { Test, TestingModule } from '@nestjs/testing';
import { LedgerService } from './ledger.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { BadRequestException } from '@nestjs/common';

describe('LedgerService', () => {
  let service: LedgerService;

  const mockPrismaService = {
    ledgerAccount: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    journalEntry: {
      create: jest.fn(),
      aggregate: jest.fn(),
      findMany: jest.fn(),
    },
  };

  const mockAuditLogsService = {
    log: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LedgerService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: AuditLogsService, useValue: mockAuditLogsService },
      ],
    }).compile();

    service = module.get<LedgerService>(LedgerService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should post a valid double-entry journal entry', async () => {
    mockPrismaService.ledgerAccount.findUnique
      .mockResolvedValueOnce({ id: 'acc-debit', accountCode: 'AGENCY:1:USD', accountType: 'asset' })
      .mockResolvedValueOnce({ id: 'acc-credit', accountCode: 'CLEARING:USD', accountType: 'liability' });

    mockPrismaService.journalEntry.create.mockResolvedValue({
      id: 'je-1',
      debitAccountId: 'acc-debit',
      creditAccountId: 'acc-credit',
      amount: 500,
      currency: 'USD',
      status: 'posted',
    });

    const entry = await service.postJournalEntry({
      debitAccountCode: 'AGENCY:1:USD',
      creditAccountCode: 'CLEARING:USD',
      amount: 500,
      referenceType: 'PAYMENT',
      description: 'Test payment entry',
    });

    expect(entry.id).toBe('je-1');
    expect(mockPrismaService.journalEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'posted',
        }),
      }),
    );
  });

  it('should reject non-positive amounts', async () => {
    await expect(
      service.postJournalEntry({
        debitAccountCode: 'A',
        creditAccountCode: 'B',
        amount: 0,
        referenceType: 'PAYMENT',
        description: 'Invalid',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('should calculate account balance from debits and credits', async () => {
    mockPrismaService.ledgerAccount.findUnique.mockResolvedValue({
      id: 'acc-1',
      accountCode: 'AGENCY:1:USD',
      accountType: 'asset',
      currency: 'USD',
    });

    mockPrismaService.journalEntry.aggregate
      .mockResolvedValueOnce({ _sum: { amount: 1500 } }) // Debits
      .mockResolvedValueOnce({ _sum: { amount: 500 } });  // Credits

    const result = await service.getAccountBalance('AGENCY:1:USD');
    expect(result.debitTotal).toBe(1500);
    expect(result.creditTotal).toBe(500);
    expect(result.balance).toBe(1000); // 1500 - 500
  });
});

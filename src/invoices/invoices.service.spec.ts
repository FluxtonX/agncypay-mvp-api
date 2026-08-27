import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InvoicesService } from './invoices.service';
import { InvoiceRepository } from '../infrastructure/database/repositories/invoice.repository';
import { UserRepository } from '../infrastructure/database/repositories/user.repository';
import { AuditLogsService } from '../modules/audit-logs/audit-logs.service';
import { WalletsService } from '../modules/wallets/wallets.service';
import { PrismaService } from '../prisma/prisma.service';

describe('InvoicesService', () => {
  let service: InvoicesService;
  let mockInvoiceRepo: any;
  let mockWalletsService: any;
  let mockAuditLogsService: any;

  beforeEach(async () => {
    mockInvoiceRepo = {
      findById: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
    };

    mockWalletsService = {
      getOrCreateWalletForUser: jest.fn().mockResolvedValue({ id: 'w1', walletId: 'WAL-1' }),
      recordTransaction: jest.fn().mockResolvedValue({ id: 'tx1' }),
    };

    mockAuditLogsService = {
      log: jest.fn().mockResolvedValue({ id: 'log1' }),
    };

    const mockPrisma = {
      bankDetails: { findUnique: jest.fn() },
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'u1' }) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InvoicesService,
        { provide: InvoiceRepository, useValue: mockInvoiceRepo },
        { provide: UserRepository, useValue: { findByEmail: jest.fn(), create: jest.fn() } },
        { provide: AuditLogsService, useValue: mockAuditLogsService },
        { provide: WalletsService, useValue: mockWalletsService },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
      ],
    }).compile();

    service = module.get<InvoicesService>(InvoicesService);
  });

  it('should update invoice status to paid and record double-entry ledger transactions', async () => {
    mockInvoiceRepo.findById.mockResolvedValue({
      id: 'W-INV-1001',
      invoiceNumber: 'W-INV-1001',
      status: 'pending',
      amount: 1000,
      brandId: 'brand-1',
      agencyId: 'agency-1',
      payoutStatus: 'pending',
    });

    mockInvoiceRepo.update.mockResolvedValue({
      id: 'W-INV-1001',
      invoiceNumber: 'W-INV-1001',
      status: 'paid',
      amount: 1000,
      brandId: 'brand-1',
      agencyId: 'agency-1',
      payoutStatus: 'pending',
    });

    const result = await service.updateInvoiceStatus('W-INV-1001', 'paid');

    expect(result.status).toBe('paid');
    expect(mockWalletsService.recordTransaction).toHaveBeenCalledTimes(2);
  });
});

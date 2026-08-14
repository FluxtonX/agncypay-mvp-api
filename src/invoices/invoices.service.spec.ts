import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InvoicesService } from './invoices.service';
import { InvoiceRepository } from '../infrastructure/database/repositories/invoice.repository';
import { UserRepository } from '../infrastructure/database/repositories/user.repository';
import { ModernTreasuryProvider } from '../infrastructure/providers/modern-treasury/modern-treasury.provider';
import { AuditLogsService } from '../modules/audit-logs/audit-logs.service';
import { WalletsService } from '../modules/wallets/wallets.service';
import { PrismaService } from '../prisma/prisma.service';

describe('InvoicesService Modern Treasury Webhooks', () => {
  let service: InvoicesService;
  let mockInvoiceRepo: any;
  let mockModernTreasuryProvider: any;
  let mockWalletsService: any;
  let mockAuditLogsService: any;

  beforeEach(async () => {
    mockInvoiceRepo = {
      findById: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
    };

    mockModernTreasuryProvider = {
      verifyWebhookSignature: jest.fn(),
      processACHPayment: jest.fn(),
      getPaymentStatus: jest.fn(),
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
      webhookEvent: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: 'we1' }) },
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'u1', modernTreasuryInternalAccountId: 'ia_1' }) },
      payout: { findUnique: jest.fn(), update: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InvoicesService,
        { provide: InvoiceRepository, useValue: mockInvoiceRepo },
        { provide: UserRepository, useValue: {} },
        { provide: ModernTreasuryProvider, useValue: mockModernTreasuryProvider },
        { provide: AuditLogsService, useValue: mockAuditLogsService },
        { provide: WalletsService, useValue: mockWalletsService },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
      ],
    }).compile();

    service = module.get<InvoicesService>(InvoicesService);
  });

  it('should process payment_order.completed webhook and update invoice status to paid', async () => {
    mockModernTreasuryProvider.verifyWebhookSignature.mockReturnValue(true);
    mockInvoiceRepo.findById.mockResolvedValue({
      id: 'W-INV-1001',
      invoiceNumber: 'W-INV-1001',
      status: 'pending',
      amount: 1000,
      brandId: 'brand-1',
      agencyId: 'agency-1',
    });

    const result = await service.handleModernTreasuryWebhook(
      {
        event: 'payment_order.completed',
        data: {
          id: 'po_123',
          status: 'completed',
          metadata: { invoiceId: 'W-INV-1001' },
        },
      },
      '{}',
      'simulated_signature_valid',
    );

    expect(result).toEqual({ status: 'success', eventType: 'payment_order.completed', invoiceId: 'W-INV-1001' });
    expect(mockInvoiceRepo.update).toHaveBeenCalledWith('W-INV-1001', {
      status: 'paid',
      payoutStatus: 'disbursed',
    });
    expect(mockWalletsService.recordTransaction).toHaveBeenCalledTimes(2);
  });

  it('should handle payment_order.returned webhook and reverse ledger', async () => {
    mockModernTreasuryProvider.verifyWebhookSignature.mockReturnValue(true);
    mockInvoiceRepo.findById.mockResolvedValue({
      id: 'W-INV-1002',
      invoiceNumber: 'W-INV-1002',
      status: 'paid',
      amount: 500,
      brandId: 'brand-1',
      agencyId: 'agency-1',
    });

    const result = await service.handleModernTreasuryWebhook(
      {
        event: 'payment_order.returned',
        data: {
          id: 'po_124',
          status: 'returned',
          metadata: { invoiceId: 'W-INV-1002' },
        },
      },
      '{}',
      'simulated_signature_valid',
    );

    expect(result).toEqual({ status: 'success', eventType: 'payment_order.returned', invoiceId: 'W-INV-1002' });
    expect(mockInvoiceRepo.update).toHaveBeenCalledWith('W-INV-1002', {
      status: 'overdue',
      payoutStatus: 'pending',
    });
    expect(mockWalletsService.recordTransaction).toHaveBeenCalledTimes(2);
  });
});

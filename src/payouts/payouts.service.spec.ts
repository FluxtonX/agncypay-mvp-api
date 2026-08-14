import { Test, TestingModule } from '@nestjs/testing';
import { PayoutsService } from './payouts.service';
import { PrismaService } from '../prisma/prisma.service';
import { ModernTreasuryProvider } from '../infrastructure/providers/modern-treasury/modern-treasury.provider';
import { AuditLogsService } from '../modules/audit-logs/audit-logs.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';

describe('PayoutsService', () => {
  let service: PayoutsService;
  let mockPrisma: any;
  let mockModernTreasuryProvider: any;
  let mockAuditLogsService: any;

  beforeEach(async () => {
    mockPrisma = {
      user: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      agencyExternalAccount: {
        create: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        updateMany: jest.fn(),
      },
      payout: {
        create: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
      },
    };

    mockModernTreasuryProvider = {
      createCounterparty: jest.fn().mockResolvedValue({ counterpartyId: 'cp_123' }),
      createExternalAccount: jest.fn().mockResolvedValue({ externalAccountId: 'ea_123' }),
      getLedgerAccountBalance: jest.fn().mockResolvedValue({ postedBalance: 5000, pendingBalance: 0, currency: 'USD' }),
      createPayout: jest.fn().mockResolvedValue({ paymentOrderId: 'po_payout_1', status: 'success' }),
    };

    mockAuditLogsService = {
      log: jest.fn().mockResolvedValue({ id: 'log1' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PayoutsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ModernTreasuryProvider, useValue: mockModernTreasuryProvider },
        { provide: AuditLogsService, useValue: mockAuditLogsService },
      ],
    }).compile();

    service = module.get<PayoutsService>(PayoutsService);
  });

  it('should add agency external account', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'agency-1',
      fullName: 'Test Agency',
      modernTreasuryCounterpartyId: 'cp_123',
    });

    mockPrisma.agencyExternalAccount.create.mockResolvedValue({
      id: 'ext-acc-1',
      agencyId: 'agency-1',
      accountName: 'Payout Bank A',
      modernTreasuryExternalAccountId: 'ea_123',
    });

    const res = await service.addAgencyExternalAccount({
      agencyId: 'agency-1',
      accountName: 'Payout Bank A',
      bankName: 'Chase Bank',
      accountNumber: '123456789',
      routingNumber: '111000025',
    });

    expect(res).toBeDefined();
    expect(res.id).toBe('ext-acc-1');
    expect(mockModernTreasuryProvider.createExternalAccount).toHaveBeenCalled();
  });

  it('should request payout when sufficient MT Ledger balance exists', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'agency-1',
      modernTreasuryInternalAccountId: 'ia_agency_1',
      modernTreasuryLedgerAccountId: 'leg_agency_1',
    });

    mockPrisma.agencyExternalAccount.findFirst.mockResolvedValue({
      id: 'ext-acc-1',
      agencyId: 'agency-1',
      modernTreasuryExternalAccountId: 'ea_123',
      accountName: 'Payout Bank A',
    });

    mockPrisma.payout.create.mockResolvedValue({
      id: 'payout-1',
      agencyId: 'agency-1',
      amount: 2000,
      status: 'processing',
    });

    mockPrisma.payout.update.mockResolvedValue({
      id: 'payout-1',
      paymentOrderId: 'po_payout_1',
      status: 'disbursed',
    });

    const payout = await service.requestPayout({
      agencyId: 'agency-1',
      amount: 2000,
      destinationExternalAccountId: 'ext-acc-1',
    });

    expect(payout.status).toBe('disbursed');
    expect(mockModernTreasuryProvider.createPayout).toHaveBeenCalledWith({
      payoutId: 'payout-1',
      agencyId: 'agency-1',
      amount: 2000,
      currency: 'USD',
      originatingInternalAccountId: 'ia_agency_1',
      receivingExternalAccountId: 'ea_123',
      paymentType: 'ach',
    });
  });

  it('should throw BadRequestException on insufficient balance', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'agency-1',
      modernTreasuryInternalAccountId: 'ia_agency_1',
      modernTreasuryLedgerAccountId: 'leg_agency_1',
    });

    mockModernTreasuryProvider.getLedgerAccountBalance.mockResolvedValue({
      postedBalance: 500,
      pendingBalance: 0,
      currency: 'USD',
    });

    await expect(
      service.requestPayout({
        agencyId: 'agency-1',
        amount: 2000,
        destinationExternalAccountId: 'ext-acc-1',
      }),
    ).rejects.toThrow(BadRequestException);
  });
});

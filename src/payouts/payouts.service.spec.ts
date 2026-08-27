import { Test, TestingModule } from '@nestjs/testing';
import { PayoutsService } from './payouts.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../modules/audit-logs/audit-logs.service';
import { LedgerService } from '../modules/ledger/ledger.service';
import { CybridCustomerService } from '../modules/cybrid/cybrid-customer.service';
import { CybridAccountService } from '../modules/cybrid/cybrid-account.service';
import { PayoutStateService } from '../modules/payouts/payout-state.service';
import { CybridConfigService } from '../infrastructure/providers/cybrid/cybrid-config.service';
import { BadRequestException } from '@nestjs/common';

describe('PayoutsService', () => {
  let service: PayoutsService;
  let mockPrisma: any;
  let mockAuditLogsService: any;
  let mockLedgerService: any;
  let mockCustomerService: any;
  let mockAccountService: any;
  let mockPayoutStateService: any;
  let mockCybridConfig: any;
  let mockCybridProvider: any;

  beforeEach(async () => {
    mockPrisma = {
      user: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      talent: {
        findFirst: jest.fn(),
      },
      agencyExternalAccount: {
        create: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        updateMany: jest.fn(),
      },
      paymentPayout: {
        create: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
      },
      providerOperation: {
        create: jest.fn(),
      },
      payout: {
        create: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
      },
    };

    mockAuditLogsService = {
      log: jest.fn().mockResolvedValue({ id: 'log1' }),
    };

    mockLedgerService = {
      getAccountBalance: jest.fn().mockResolvedValue({ balance: 50000 }),
      postJournalEntry: jest.fn().mockResolvedValue({ id: 'je1' }),
    };

    mockCustomerService = {
      createOrGetCustomer: jest.fn().mockResolvedValue({ id: 'cust1', cybridCustomerGuid: 'guid1' }),
    };

    mockAccountService = {
      ensureUsdFiatAccount: jest.fn().mockResolvedValue({ id: 'acc1', cybridAccountGuid: 'acc_guid1' }),
      ensureTradingAccount: jest.fn().mockResolvedValue({ id: 'acc2', cybridAccountGuid: 'acc_guid2' }),
    };

    mockPayoutStateService = {
      transition: jest.fn().mockResolvedValue({ id: 'payout1' }),
    };

    mockCybridConfig = {
      isConfigured: false,
    };

    mockCybridProvider = {
      createQuote: jest.fn(),
      createTransfer: jest.fn(),
      createTrade: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PayoutsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditLogsService, useValue: mockAuditLogsService },
        { provide: LedgerService, useValue: mockLedgerService },
        { provide: CybridCustomerService, useValue: mockCustomerService },
        { provide: CybridAccountService, useValue: mockAccountService },
        { provide: PayoutStateService, useValue: mockPayoutStateService },
        { provide: CybridConfigService, useValue: mockCybridConfig },
        { provide: 'IFinancialProvider', useValue: mockCybridProvider },
      ],
    }).compile();

    service = module.get<PayoutsService>(PayoutsService);
  });

  it('should add agency external account', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'agency-1',
      fullName: 'Test Agency',
      providerCounterpartyId: 'cp_123',
    });

    mockPrisma.agencyExternalAccount.create.mockResolvedValue({
      id: 'ext-acc-1',
      agencyId: 'agency-1',
      accountName: 'Payout Bank A',
      providerExternalAccountId: 'ea_123',
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
  });

  it('should request agency withdrawal when valid account exists', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'agency-1',
    });

    mockPrisma.agencyExternalAccount.findFirst.mockResolvedValue({
      id: 'ext-acc-1',
      agencyId: 'agency-1',
      providerExternalAccountId: 'ea_123',
      accountName: 'Payout Bank A',
      bankName: 'Chase',
      accountNumberMask: '6789',
    });

    mockPrisma.paymentPayout.create.mockResolvedValue({
      id: 'payout-1',
      agencyId: 'agency-1',
      amount: 2000,
      status: 'TRANSFER_PENDING',
    });

    const payout = await service.requestAgencyWithdrawal({
      agencyId: 'agency-1',
      amount: 2000,
      destinationExternalAccountId: 'ext-acc-1',
    });

    expect(payout.status).toBe('TRANSFER_PENDING');
  });

  it('should request domestic talent payout', async () => {
    mockPrisma.talent.findFirst.mockResolvedValue({
      id: 'talent-1',
      fullName: 'Alex Talent',
      counterparties: [
        {
          id: 'cp-1',
          cybridCounterpartyGuid: 'cpguid-1',
          externalBankAccounts: [{ id: 'eba-1', cybridExternalBankGuid: 'ebaguid-1' }],
        },
      ],
    });

    mockPrisma.paymentPayout.create.mockResolvedValue({
      id: 'po-1',
      amount: 1000,
      status: 'VALIDATING',
    });

    mockPrisma.paymentPayout.update.mockResolvedValue({
      id: 'po-1',
      amount: 1000,
      status: 'TRANSFER_PENDING',
    });

    const result = await service.requestDomesticTalentPayout({
      agencyId: 'agency-1',
      talentId: 'talent-1',
      amount: 1000,
    });

    expect(result.id).toBe('po-1');
    expect(mockLedgerService.postJournalEntry).toHaveBeenCalled();
  });

  it('should throw BadRequestException on non-positive payout amount', async () => {
    await expect(
      service.requestAgencyWithdrawal({
        agencyId: 'agency-1',
        amount: -500,
        destinationExternalAccountId: 'ext-acc-1',
      }),
    ).rejects.toThrow(BadRequestException);
  });
});

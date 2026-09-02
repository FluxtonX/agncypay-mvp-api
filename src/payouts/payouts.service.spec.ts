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

import { ExternalBankAccountService } from '../modules/cybrid/external-bank-account.service';

describe('PayoutsService', () => {
  let service: PayoutsService;
  let mockPrisma: any;
  let mockAuditLogsService: any;
  let mockLedgerService: any;
  let mockCustomerService: any;
  let mockAccountService: any;
  let mockExternalBankAccountService: any;
  let mockPayoutStateService: any;
  let mockCybridConfig: any;
  let mockCybridProvider: any;

  beforeEach(async () => {
    mockPrisma = {
      $transaction: jest.fn(async (cb) => cb(mockPrisma)),
      user: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      ledgerAccount: {
        findUnique: jest.fn().mockResolvedValue({ id: 'la_1', accountCode: 'AGENCY:agency-1:USD' }),
      },
      journalEntry: {
        aggregate: jest.fn().mockImplementation(async (params) => {
          if (params?.where?.creditAccountId) {
            return { _sum: { amount: 50000 } };
          }
          return { _sum: { amount: 0 } };
        }),
        create: jest.fn().mockResolvedValue({ id: 'je_res_1', status: 'pending' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      agencyExternalAccount: {
        create: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        updateMany: jest.fn(),
      },
      cybridExternalBankAccount: {
        findFirst: jest.fn().mockResolvedValue({ status: 'completed' }),
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
      wallet: {
        findFirst: jest.fn(),
        update: jest.fn(),
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
      getOrCreateAccount: jest.fn().mockResolvedValue({ id: 'la_1' }),
      postJournalEntry: jest.fn().mockResolvedValue({ id: 'je1' }),
    };

    mockCustomerService = {
      createOrGetCustomer: jest.fn().mockResolvedValue({ id: 'cust1', cybridCustomerGuid: 'guid1' }),
    };

    mockAccountService = {
      ensureUsdFiatAccount: jest.fn().mockResolvedValue({ id: 'acc1', cybridAccountGuid: 'acc_guid1' }),
      ensureTradingAccount: jest.fn().mockResolvedValue({ id: 'acc2', cybridAccountGuid: 'acc_guid2' }),
    };

    mockExternalBankAccountService = {
      linkAgencyBankAccount: jest.fn().mockResolvedValue({ id: 'ext-acc-1' }),
    };

    mockPayoutStateService = {
      transition: jest.fn().mockResolvedValue({ id: 'payout1' }),
    };

    mockCybridConfig = {
      isConfigured: true,
    };

    mockCybridProvider = {
      createQuote: jest.fn().mockResolvedValue({ guid: 'quote-1' }),
      createTransfer: jest.fn().mockResolvedValue({ guid: 'transfer-1' }),
      createTrade: jest.fn().mockResolvedValue({ guid: 'trade-1' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PayoutsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditLogsService, useValue: mockAuditLogsService },
        { provide: LedgerService, useValue: mockLedgerService },
        { provide: CybridCustomerService, useValue: mockCustomerService },
        { provide: CybridAccountService, useValue: mockAccountService },
        { provide: ExternalBankAccountService, useValue: mockExternalBankAccountService },
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
    mockPrisma.user.findFirst.mockResolvedValue({
      id: 'talent-1',
      fullName: 'Alex Talent',
      accountType: 'talent',
      talentCounterparties: [
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
      status: 'RESERVED',
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
    expect(mockPrisma.journalEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'pending',
          referenceType: 'DOMESTIC_TALENT_PAYOUT',
        }),
      }),
    );
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

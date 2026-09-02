import { Test, TestingModule } from '@nestjs/testing';
import { TalentBankAccountsService } from './talent-bank-accounts.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../modules/audit-logs/audit-logs.service';
import { PlaidProvider } from '../infrastructure/providers/plaid/plaid.provider';
import { CybridConfigService } from '../infrastructure/providers/cybrid/cybrid-config.service';

describe('TalentBankAccountsService', () => {
  let service: TalentBankAccountsService;
  let prisma: any;
  let plaidProvider: any;
  let cybridProvider: any;

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'talent_user_1',
          fullName: 'Jane Talent',
          email: 'jane@example.com',
          cybridCustomer: { cybridCustomerGuid: 'cust_guid_abc' },
        }),
      },
      cybridCustomer: {
        create: jest.fn(),
      },
      cybridExternalBankAccount: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({
          id: 'eba_db_1',
          cybridExternalBankGuid: 'eba_guid_123',
          bankName: 'Chase Bank',
          mask: '4829',
          asset: 'USD',
          status: 'completed',
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
        update: jest.fn(),
      },
      bankDetails: {
        upsert: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn().mockResolvedValue(null),
      },
      agencyExternalAccount: {
        upsert: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({}),
        deleteMany: jest.fn().mockResolvedValue({}),
      },
    };

    plaidProvider = {
      createLinkToken: jest.fn().mockResolvedValue({
        linkToken: 'link-sandbox-12345',
        expiration: '2026-09-02T12:00:00Z',
      }),
      exchangePublicToken: jest.fn().mockResolvedValue({
        accessToken: 'access-sandbox-token-123',
        itemId: 'item_123',
        accounts: [
          {
            accountId: 'acc_chase_checking',
            bankName: 'Chase',
            accountNumberMask: '4829',
            accountHolderName: 'Jane Checking',
            routingNumber: '111000025',
          },
        ],
      }),
      createProcessorToken: jest.fn().mockResolvedValue('processor-cybrid-token-abc'),
      createSandboxPublicToken: jest.fn().mockResolvedValue('public-sandbox-token-xyz'),
    };

    cybridProvider = {
      createExternalBankAccount: jest.fn().mockResolvedValue({
        guid: 'eba_guid_123',
        name: 'Chase Checking (****4829)',
        state: 'completed',
      }),
      createCustomer: jest.fn().mockResolvedValue({
        guid: 'cust_guid_abc',
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TalentBankAccountsService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: AuditLogsService,
          useValue: { log: jest.fn().mockResolvedValue({}) },
        },
        { provide: PlaidProvider, useValue: plaidProvider },
        {
          provide: CybridConfigService,
          useValue: { isConfigured: true },
        },
        { provide: 'IFinancialProvider', useValue: cybridProvider },
      ],
    }).compile();

    service = module.get<TalentBankAccountsService>(TalentBankAccountsService);
  });

  it('should create Plaid Link Token for authenticated Talent', async () => {
    const res = await service.createLinkToken('talent_user_1');
    expect(res.linkToken).toBe('link-sandbox-12345');
    expect(plaidProvider.createLinkToken).toHaveBeenCalledWith('talent_user_1');
  });

  it('should complete Plaid Link, generate processor token and create Cybrid EBA', async () => {
    const res = await service.completePlaidLink('talent_user_1', {
      publicToken: 'public-sandbox-abc',
      accountId: 'acc_chase_checking',
      institutionName: 'Chase',
    });

    expect(res.status).toBe('READY');
    expect(res.isPayoutEligible).toBe(true);
    expect(res.accountMask).toBe('4829');
    expect(plaidProvider.exchangePublicToken).toHaveBeenCalledWith({
      userId: 'talent_user_1',
      publicToken: 'public-sandbox-abc',
    });
    expect(plaidProvider.createProcessorToken).toHaveBeenCalledWith(
      'access-sandbox-token-123',
      'acc_chase_checking',
      'cybrid',
    );
    expect(cybridProvider.createExternalBankAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        accountKind: 'plaid_processor_token',
        plaidProcessorToken: 'processor-cybrid-token-abc',
      }),
    );
  });

  it('should return existing bank account if already linked (idempotency)', async () => {
    prisma.cybridExternalBankAccount.findFirst.mockResolvedValueOnce({
      id: 'eba_db_existing',
      bankName: 'Chase',
      mask: '4829',
      asset: 'USD',
      status: 'completed',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await service.completePlaidLink('talent_user_1', {
      publicToken: 'public-sandbox-abc',
      accountId: 'acc_chase_checking',
    });

    expect(res.id).toBe('eba_db_existing');
    expect(cybridProvider.createExternalBankAccount).not.toHaveBeenCalled();
  });

  it('should list linked bank accounts and mark READY when completed in Cybrid', async () => {
    prisma.cybridExternalBankAccount.findMany.mockResolvedValue([
      {
        id: 'eba_1',
        bankName: 'Chase',
        mask: '4829',
        asset: 'USD',
        status: 'completed',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const accounts = await service.getBankAccounts('talent_user_1');
    expect(accounts).toHaveLength(1);
    expect(accounts[0].status).toBe('READY');
    expect(accounts[0].isPayoutEligible).toBe(true);
  });

  it('should set default bank account and audit log', async () => {
    prisma.cybridExternalBankAccount.findFirst.mockResolvedValue({
      id: 'eba_1',
      cybridExternalBankGuid: 'eba_guid_123',
    });

    const res = await service.setDefaultBankAccount('talent_user_1', 'eba_1');
    expect(res.success).toBe(true);
    expect(prisma.agencyExternalAccount.updateMany).toHaveBeenCalledTimes(2);
  });

  it('should delete a bank account', async () => {
    prisma.cybridExternalBankAccount.findFirst.mockResolvedValue({
      id: 'eba_1',
      cybridExternalBankGuid: 'eba_guid_123',
    });

    const res = await service.deleteBankAccount('talent_user_1', 'eba_1');
    expect(res.success).toBe(true);
    expect(prisma.cybridExternalBankAccount.update).toHaveBeenCalledWith({
      where: { id: 'eba_1' },
      data: { status: 'deleted' },
    });
  });
});

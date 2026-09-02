import { Test, TestingModule } from '@nestjs/testing';
import { TalentService } from './talent.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../modules/audit-logs/audit-logs.service';
import { CybridCustomerService } from '../modules/cybrid/cybrid-customer.service';
import { ExternalBankAccountService } from '../modules/cybrid/external-bank-account.service';
import { CybridConfigService } from '../infrastructure/providers/cybrid/cybrid-config.service';

describe('TalentService', () => {
  let service: TalentService;
  let prisma: any;
  let customerService: any;
  let externalBankAccountService: any;
  let cybridProvider: any;

  beforeEach(async () => {
    prisma = {
      user: {
        create: jest.fn(),
        findUnique: jest.fn().mockResolvedValue({ id: 'agency_1', fullName: 'Agency One' }),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      cybridCounterparty: {
        create: jest.fn(),
      },
    };

    customerService = {
      createOrGetCustomer: jest.fn().mockResolvedValue({
        id: 'cust_db_1',
        cybridCustomerGuid: 'cust_guid_123',
      }),
    };

    externalBankAccountService = {
      linkTalentBankAccount: jest.fn().mockResolvedValue({
        id: 'eba_db_1',
        cybridExternalBankGuid: 'eba_guid_123',
      }),
    };

    cybridProvider = {
      createCounterparty: jest.fn().mockResolvedValue({ guid: 'cp_guid_123' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TalentService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: AuditLogsService,
          useValue: { log: jest.fn().mockResolvedValue({}) },
        },
        { provide: CybridCustomerService, useValue: customerService },
        { provide: ExternalBankAccountService, useValue: externalBankAccountService },
        {
          provide: CybridConfigService,
          useValue: { isConfigured: true },
        },
        { provide: 'IFinancialProvider', useValue: cybridProvider },
      ],
    }).compile();

    service = module.get<TalentService>(TalentService);
  });

  it('should create a domestic talent and Cybrid counterparty', async () => {
    prisma.user.findUnique.mockResolvedValueOnce({ id: 'agency_1', fullName: 'Agency One' }).mockResolvedValueOnce(null);
    prisma.user.create.mockResolvedValue({
      id: 'tal_1',
      agencyId: 'agency_1',
      fullName: 'John Doe',
      accountType: 'talent',
    });

    prisma.cybridCounterparty.create.mockResolvedValue({
      id: 'cp_1',
      cybridCounterpartyGuid: 'cp_guid_123',
      talentId: 'tal_1',
    });

    const result = await service.createTalent({
      agencyId: 'agency_1',
      fullName: 'John Doe',
      country: 'US',
    });

    expect(result.talent.id).toBe('tal_1');
    expect(cybridProvider.createCounterparty).toHaveBeenCalledWith(
      expect.objectContaining({
        customerGuid: 'cust_guid_123',
        type: 'individual',
      }),
    );
  });

  it('should link bank account for talent', async () => {
    prisma.user.findFirst.mockResolvedValue({
      id: 'tal_1',
      agencyId: 'agency_1',
      fullName: 'John Doe',
      talentCounterparties: [],
    });

    const res = await service.linkBankAccount('tal_1', 'agency_1', {
      bankName: 'Chase Bank',
      accountNumber: '1234567890',
      routingNumber: '111000025',
    });

    expect(externalBankAccountService.linkTalentBankAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        talentId: 'tal_1',
        agencyId: 'agency_1',
        bankName: 'Chase Bank',
      }),
    );
    expect(res.id).toBe('eba_db_1');
  });

  it('should enforce agency tenant isolation when querying talents', async () => {
    prisma.user.findMany.mockResolvedValue([{ id: 'tal_1', agencyId: 'agency_1', accountType: 'talent' }]);

    const list = await service.getTalents('agency_1');
    expect(list).toHaveLength(1);
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { agencyId: 'agency_1', accountType: 'talent', deletedAt: null },
      }),
    );
  });
});

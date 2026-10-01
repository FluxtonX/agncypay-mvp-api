import { BadRequestException } from '@nestjs/common';
import { TalentBankAccountsService } from './talent-bank-accounts.service';

describe('TalentBankAccountsService', () => {
  const account = {
    id: 'financial-account-1',
    participantId: 'participant-1',
    type: 'external_bank',
    status: 'ready',
    currency: 'USD',
    country: 'USA',
    displayName: 'Checking',
    institutionName: 'Test Bank',
    lastFour: '6789',
    isPrimary: true,
    metadata: { subtype: 'checking' },
    deletedAt: null,
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
    updatedAt: new Date('2026-10-01T00:00:00.000Z'),
  };

  function setup() {
    const financialAccount = {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn(),
      create: jest.fn().mockResolvedValue(account),
      update: jest.fn(),
    };
    const providerAccountMap = { updateMany: jest.fn() };
    const prisma: any = {
      participantUser: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ participantId: 'participant-1' }),
      },
      user: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'user-1', fullName: 'Talent One' }),
      },
      financialAccount,
      providerAccountMap,
      providerPartyMap: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ externalId: 'provider-party-1' }),
      },
      paymentInstruction: { count: jest.fn().mockResolvedValue(0) },
      $transaction: jest.fn(async (operation: any) => {
        if (typeof operation === 'function') {
          return operation({ financialAccount, providerAccountMap });
        }
        return Promise.all(operation);
      }),
    };
    const plaid: any = {
      exchangePublicToken: jest.fn().mockResolvedValue({
        accessToken: 'plaid-access-secret',
        itemId: 'plaid-item-1',
        accounts: [
          {
            accountId: 'plaid-account-1',
            accountName: 'Checking',
            accountHolderName: 'Talent One',
            accountNumber: '123456789',
            accountNumberMask: '6789',
            routingNumber: '011401533',
            institutionName: 'Test Bank',
            subtype: 'checking',
          },
        ],
      }),
    };
    const paymentProvider: any = {
      name: 'conduit',
      createRecipient: jest.fn().mockResolvedValue({
        id: 'recipient-1',
        partyId: 'provider-party-1',
        name: 'Talent One',
        status: 'active',
        payoutRail: 'ach',
      }),
    };
    const audit: any = { log: jest.fn() };
    const service = new TalentBankAccountsService(
      prisma,
      audit,
      plaid,
      paymentProvider,
    );
    return { service, prisma, plaid, paymentProvider, audit, financialAccount };
  }

  it('registers verified bank details through the generic payment provider', async () => {
    const { service, paymentProvider, financialAccount } = setup();

    const result = await service.completePlaidLink('user-1', {
      publicToken: 'public-token',
      accountId: 'plaid-account-1',
    });

    expect(paymentProvider.createRecipient).toHaveBeenCalledWith(
      expect.objectContaining({
        partyId: 'provider-party-1',
        accountNumber: '123456789',
        routingNumber: '011401533',
        payoutRail: 'ach',
      }),
    );
    const createInput = financialAccount.create.mock.calls[0][0].data;
    expect(createInput).not.toHaveProperty('accountNumber');
    expect(createInput.providerAccounts.create).toEqual(
      expect.objectContaining({
        provider: 'conduit',
        externalId: 'recipient-1',
      }),
    );
    expect(createInput.metadata.plaidAccessTokenEncrypted).not.toBe(
      'plaid-access-secret',
    );
    expect(result.id).toBe('financial-account-1');
    expect(result.isPayoutEligible).toBe(true);
  });

  it('refuses a Plaid account without verified ACH details', async () => {
    const { service, plaid, paymentProvider } = setup();
    plaid.exchangePublicToken.mockResolvedValue({
      accessToken: 'access',
      itemId: 'item',
      accounts: [{ accountId: 'account-1', accountNumberMask: '1234' }],
    });

    await expect(
      service.completePlaidLink('user-1', { publicToken: 'public-token' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(paymentProvider.createRecipient).not.toHaveBeenCalled();
  });

  it('does not remove a bank account with an active withdrawal', async () => {
    const { service, prisma } = setup();
    prisma.financialAccount.findFirst.mockResolvedValue(account);
    prisma.paymentInstruction.count.mockResolvedValue(1);

    await expect(
      service.deleteBankAccount('user-1', account.id),
    ).rejects.toThrow('Bank account has an active withdrawal');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

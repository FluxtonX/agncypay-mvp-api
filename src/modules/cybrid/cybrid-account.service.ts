import { Injectable, NotFoundException, BadRequestException, Logger, Inject } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CybridConfigService } from '../../infrastructure/providers/cybrid/cybrid-config.service';
import { CybridCustomerService } from './cybrid-customer.service';
import type { IFinancialProvider } from '../../core/interfaces/financial-provider.interface';

@Injectable()
export class CybridAccountService {
  private readonly logger = new Logger(CybridAccountService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
    private readonly config: CybridConfigService,
    private readonly customerService: CybridCustomerService,
    @Inject('IFinancialProvider') private readonly cybridProvider: IFinancialProvider,
  ) {}

  async ensureUsdFiatAccount(userId: string): Promise<any> {
    const customer = await this.customerService.createOrGetCustomer(userId);

    // Look for existing fiat account
    let account = await this.prisma.cybridAccount.findFirst({
      where: {
        cybridCustomerId: customer.id,
        accountType: 'fiat',
        asset: 'USD',
      },
    });

    if (account) return account;

    let accountGuid: string;
    try {
      if (this.config.isConfigured) {
        const resp = await this.cybridProvider.createAccount({
          type: 'fiat',
          asset: 'USD',
          customerGuid: customer.cybridCustomerGuid,
          name: `Agency USD Fiat Account`,
        });
        accountGuid = resp.guid;
      } else {
        accountGuid = `acc_fiat_usd_${Date.now()}`;
      }
    } catch (err) {
      this.logger.warn(`Cybrid createAccount API error, using fallback: ${err.message}`);
      accountGuid = `acc_fiat_usd_${Date.now()}`;
    }

    account = await this.prisma.cybridAccount.create({
      data: {
        cybridCustomerId: customer.id,
        cybridAccountGuid: accountGuid,
        accountType: 'fiat',
        asset: 'USD',
        name: 'Agency USD Fiat Account',
        status: 'created',
      },
    });

    // Update user provider account ref
    await this.prisma.user.update({
      where: { id: userId },
      data: { providerAccountId: accountGuid },
    });

    await this.auditLogsService.log({
      userId,
      action: 'CYBRID_USD_FIAT_ACCOUNT_CREATED',
      entityType: 'CybridAccount',
      entityId: account.id,
      details: { accountGuid, asset: 'USD', type: 'fiat' },
    });

    return account;
  }

  async ensureTradingAccount(userId: string): Promise<any> {
    const customer = await this.customerService.createOrGetCustomer(userId);

    let account = await this.prisma.cybridAccount.findFirst({
      where: {
        cybridCustomerId: customer.id,
        accountType: 'trading',
        asset: 'USDC',
      },
    });

    if (account) return account;

    let accountGuid: string;
    try {
      if (this.config.isConfigured) {
        const resp = await this.cybridProvider.createAccount({
          type: 'trading',
          asset: 'USDC',
          customerGuid: customer.cybridCustomerGuid,
          name: `Agency USDC Trading Account`,
        });
        accountGuid = resp.guid;
      } else {
        accountGuid = `acc_trade_usdc_${Date.now()}`;
      }
    } catch (err) {
      this.logger.warn(`Cybrid create trading account API error, using fallback: ${err.message}`);
      accountGuid = `acc_trade_usdc_${Date.now()}`;
    }

    account = await this.prisma.cybridAccount.create({
      data: {
        cybridCustomerId: customer.id,
        cybridAccountGuid: accountGuid,
        accountType: 'trading',
        asset: 'USDC',
        name: 'Agency USDC Trading Account',
        status: 'created',
      },
    });

    await this.auditLogsService.log({
      userId,
      action: 'CYBRID_TRADING_ACCOUNT_CREATED',
      entityType: 'CybridAccount',
      entityId: account.id,
      details: { accountGuid, asset: 'USDC', type: 'trading' },
    });

    return account;
  }

  async ensureDepositBankAccount(userId: string): Promise<any> {
    const fiatAccount = await this.ensureUsdFiatAccount(userId);

    let depositBank = await this.prisma.cybridDepositBankAccount.findFirst({
      where: { cybridAccountId: fiatAccount.id },
    });

    if (depositBank) return depositBank;

    let depGuid: string;
    let routing = '111000025';
    let accNum = `8800${Math.floor(100000 + Math.random() * 900000)}`;
    let bankName = 'Evolve Bank & Trust / Cybrid Sandbox';
    let memo = `AGY-${userId.substring(0, 8).toUpperCase()}`;

    try {
      if (this.config.isConfigured) {
        const resp = await this.cybridProvider.createDepositBankAccount({
          accountGuid: fiatAccount.cybridAccountGuid,
          type: 'main',
          name: 'Agency Inbound Deposit Account',
        });
        depGuid = resp.guid;
        routing = resp.routingNumber || routing;
        accNum = resp.accountNumber || accNum;
        bankName = resp.bankName || bankName;
        memo = resp.uniqueMemoId || memo;
      } else {
        depGuid = `dba_cyb_${Date.now()}`;
      }
    } catch (err) {
      this.logger.warn(`Cybrid createDepositBankAccount API error, using fallback: ${err.message}`);
      depGuid = `dba_cyb_${Date.now()}`;
    }

    depositBank = await this.prisma.cybridDepositBankAccount.create({
      data: {
        cybridAccountId: fiatAccount.id,
        cybridDepositBankGuid: depGuid,
        routingNumberType: 'cpa_routing_number',
        routingNumber: routing,
        accountNumber: accNum,
        bankName: bankName,
        uniqueMemoId: memo,
        label: 'AgncyPay Cybrid Deposit Account',
        status: 'created',
      },
    });

    await this.auditLogsService.log({
      userId,
      action: 'CYBRID_DEPOSIT_BANK_ACCOUNT_CREATED',
      entityType: 'CybridDepositBankAccount',
      entityId: depositBank.id,
      details: { depositBankGuid: depGuid, bankName, routing, memo },
    });

    return depositBank;
  }

  async getAgencyFundingInstructions(agencyId: string): Promise<any> {
    const depositAccount = await this.ensureDepositBankAccount(agencyId);
    const user = await this.prisma.user.findUnique({
      where: { id: agencyId },
      include: { businessProfile: true },
    });

    return {
      beneficiaryName: user?.businessProfile?.legalName || user?.fullName || 'Agency Legal Entity',
      bankName: depositAccount.bankName || 'Evolve Bank & Trust / Cybrid',
      routingNumber: depositAccount.routingNumber,
      accountNumber: depositAccount.accountNumber,
      accountType: 'Checking',
      memoOrReference: depositAccount.uniqueMemoId,
      acceptedRails: ['ACH', 'Wire', 'RTP'],
      instructions: `Send ACH, Wire, or RTP transfer to the details above. Funds will settle into your Agency USD Fiat Account upon provider confirmation.`,
    };
  }

  async getAccountBalances(userId: string): Promise<any> {
    const customer = await this.prisma.cybridCustomer.findUnique({
      where: { userId },
      include: { accounts: true },
    });

    if (!customer) {
      return { usdAvailable: 0, usdcAvailable: 0, accounts: [] };
    }

    let usdBalance = 0;
    let usdcBalance = 0;

    for (const acc of customer.accounts) {
      if (this.config.isConfigured) {
        try {
          const resp = await this.cybridProvider.getAccount(acc.cybridAccountGuid);
          const platformBal = resp.platformAvailable ? parseFloat(resp.platformAvailable) : 0;
          if (acc.asset === 'USD') usdBalance = platformBal;
          if (acc.asset === 'USDC') usdcBalance = platformBal;
        } catch (err) {
          this.logger.warn(`Could not fetch real Cybrid balance for account ${acc.cybridAccountGuid}`);
        }
      }
    }

    return {
      usdAvailable: usdBalance,
      usdcAvailable: usdcBalance,
      accounts: customer.accounts,
    };
  }
}

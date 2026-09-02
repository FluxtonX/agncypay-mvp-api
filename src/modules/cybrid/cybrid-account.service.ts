import { Injectable, NotFoundException, BadRequestException, BadGatewayException, Logger, Inject } from '@nestjs/common';
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

    if (!this.config.isConfigured) {
      throw new BadGatewayException('Cybrid configuration credentials missing in environment.');
    }

    let accountGuid: string;
    try {
      const resp = await this.cybridProvider.createAccount({
        type: 'fiat',
        asset: 'USD',
        customerGuid: customer.cybridCustomerGuid,
        name: `Agency USD Fiat Account`,
      });
      accountGuid = resp.guid;
    } catch (err) {
      this.logger.error(`Cybrid createAccount API error: ${err.message}`);
      throw new BadGatewayException(`Failed to create Cybrid USD Fiat Account: ${err.message}`);
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

    if (!this.config.isConfigured) {
      throw new BadGatewayException('Cybrid configuration credentials missing in environment.');
    }

    let accountGuid: string;
    try {
      const resp = await this.cybridProvider.createAccount({
        type: 'trading',
        asset: 'USDC',
        customerGuid: customer.cybridCustomerGuid,
        name: `Agency USDC Trading Account`,
      });
      accountGuid = resp.guid;
    } catch (err) {
      this.logger.error(`Cybrid create trading account API error: ${err.message}`);
      throw new BadGatewayException(`Failed to create Cybrid USDC Trading Account: ${err.message}`);
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

    if (!this.config.isConfigured) {
      throw new BadGatewayException('Cybrid configuration credentials missing in environment.');
    }

    let depGuid: string;
    let routing: string;
    let accNum: string;
    let bankName: string;
    let memo: string;

    try {
      const resp = await this.cybridProvider.createDepositBankAccount({
        accountGuid: fiatAccount.cybridAccountGuid,
        type: 'main',
        name: 'Agency Inbound Deposit Account',
      });
      depGuid = resp.guid;
      routing = resp.routingNumber || '';
      accNum = resp.accountNumber || '';
      bankName = resp.bankName || 'Evolve Bank & Trust';
      memo = resp.uniqueMemoId || `AGY-${userId.substring(0, 8).toUpperCase()}`;

      if (!routing || !accNum) {
        throw new Error('Cybrid deposit account response did not include routing or account numbers');
      }
    } catch (err) {
      this.logger.error(`Cybrid createDepositBankAccount API error: ${err.message}`);
      throw new BadGatewayException(`Failed to provision Cybrid Deposit Bank Account: ${err.message}`);
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
      beneficiaryName: user?.businessProfile?.legalName || user?.fullName || 'Agency Account',
      bankName: depositAccount.bankName || 'Evolve Bank & Trust / Cybrid',
      routingNumber: depositAccount.routingNumber,
      accountNumber: depositAccount.accountNumber,
      accountType: 'Checking',
      memo: depositAccount.uniqueMemoId,
      depositInstructions: `Send ACH or Wire to Routing ${depositAccount.routingNumber}, Account ${depositAccount.accountNumber}. Include memo ${depositAccount.uniqueMemoId} for automated attribution.`,
    };
  }

  async syncBalances(userId: string): Promise<any> {
    const customer = await this.prisma.cybridCustomer.findUnique({
      where: { userId },
      include: { accounts: true },
    });

    if (!customer || !this.config.isConfigured) {
      return { synced: false, accounts: [] };
    }

    const liveAccounts = await this.cybridProvider.listAccounts({ customerGuid: customer.cybridCustomerGuid });
    return {
      synced: true,
      accounts: liveAccounts,
    };
  }
}

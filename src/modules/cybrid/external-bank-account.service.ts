import { Injectable, NotFoundException, BadRequestException, BadGatewayException, Logger, Inject } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { PlaidProvider } from '../../infrastructure/providers/plaid/plaid.provider';
import { CybridConfigService } from '../../infrastructure/providers/cybrid/cybrid-config.service';
import type { IFinancialProvider } from '../../core/interfaces/financial-provider.interface';

@Injectable()
export class ExternalBankAccountService {
  private readonly logger = new Logger(ExternalBankAccountService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
    private readonly plaidProvider: PlaidProvider,
    private readonly config: CybridConfigService,
    @Inject('IFinancialProvider') private readonly cybridProvider: IFinancialProvider,
  ) {}

  /**
   * Link an external bank account for a Talent Counterparty via raw routing details or Plaid
   */
  async linkTalentBankAccount(data: {
    agencyId: string;
    talentId: string;
    bankName: string;
    accountNumber: string;
    routingNumber: string;
    accountHolderName?: string;
  }) {
    const talent = await this.prisma.user.findFirst({
      where: { id: data.talentId, accountType: 'talent', deletedAt: null },
      include: { talentCounterparties: true },
    });

    if (!talent) {
      throw new NotFoundException(`Talent ${data.talentId} not found`);
    }

    const counterparty = talent.talentCounterparties[0];
    if (!counterparty) {
      throw new BadRequestException(`Talent does not have a linked Cybrid Counterparty`);
    }

    if (!this.config.isConfigured) {
      throw new BadGatewayException('Cybrid configuration credentials missing in environment.');
    }

    const mask = data.accountNumber.length >= 4 ? data.accountNumber.slice(-4) : 'XXXX';
    let externalBankGuid: string;

    try {
      const resp = await this.cybridProvider.createExternalBankAccount({
        name: `${talent.fullName} - ${data.bankName}`,
        asset: 'USD',
        accountKind: 'raw_routing_details',
        routingNumberType: 'ABA',
        routingNumber: data.routingNumber,
        accountNumber: data.accountNumber,
        counterpartyGuid: counterparty.cybridCounterpartyGuid,
      });
      externalBankGuid = resp.guid;
    } catch (err) {
      this.logger.error(`Cybrid create external bank account failed: ${err.message}`);
      throw new BadGatewayException(`Failed to link external bank account for talent: ${err.message}`);
    }

    const extAccount = await this.prisma.cybridExternalBankAccount.create({
      data: {
        cybridCounterpartyId: counterparty.id,
        cybridExternalBankGuid: externalBankGuid,
        bankName: data.bankName,
        mask: mask,
        accountKind: 'raw_routing_details',
        asset: 'USD',
        status: 'completed',
      },
    });

    await this.auditLogsService.log({
      userId: data.agencyId,
      action: 'TALENT_EXTERNAL_BANK_LINKED',
      entityType: 'CybridExternalBankAccount',
      entityId: extAccount.id,
      details: {
        talentId: data.talentId,
        counterpartyGuid: counterparty.cybridCounterpartyGuid,
        externalBankGuid,
        bankName: data.bankName,
        mask,
      },
    });

    return extAccount;
  }

  /**
   * Link an external bank account for an Agency via raw routing details or Plaid
   */
  async linkAgencyBankAccount(data: {
    agencyId: string;
    accountName: string;
    bankName: string;
    accountNumber: string;
    routingNumber: string;
    isPrimary?: boolean;
  }) {
    const user = await this.prisma.user.findUnique({
      where: { id: data.agencyId },
      include: { cybridCustomer: true },
    });

    if (!user) {
      throw new NotFoundException(`Agency ${data.agencyId} not found`);
    }

    if (!this.config.isConfigured || !user.cybridCustomer) {
      throw new BadGatewayException('Cybrid customer not provisioned or Cybrid unconfigured.');
    }

    const mask = data.accountNumber.length >= 4 ? data.accountNumber.slice(-4) : 'XXXX';
    let externalBankGuid: string;

    try {
      const resp = await this.cybridProvider.createExternalBankAccount({
        name: data.accountName,
        asset: 'USD',
        accountKind: 'raw_routing_details',
        routingNumberType: 'ABA',
        routingNumber: data.routingNumber,
        accountNumber: data.accountNumber,
        customerGuid: user.cybridCustomer.cybridCustomerGuid,
      });
      externalBankGuid = resp.guid;
    } catch (err) {
      this.logger.error(`Cybrid agency external bank link failed: ${err.message}`);
      throw new BadGatewayException(`Failed to link agency external bank account: ${err.message}`);
    }

    // Save in CybridExternalBankAccount
    const extAccount = await this.prisma.cybridExternalBankAccount.create({
      data: {
        cybridExternalBankGuid: externalBankGuid,
        customerGuid: user.cybridCustomer.cybridCustomerGuid,
        agencyUserId: data.agencyId,
        bankName: data.bankName,
        mask,
        accountKind: 'raw_routing_details',
        asset: 'USD',
        status: 'completed',
      },
    });

    // Also register in AgencyExternalAccount for compatibility
    await this.prisma.agencyExternalAccount.create({
      data: {
        agencyId: data.agencyId,
        accountName: data.accountName,
        bankName: data.bankName,
        accountNumberMask: mask,
        routingNumber: data.routingNumber,
        providerExternalAccountId: externalBankGuid,
        isPrimary: data.isPrimary || false,
      },
    });

    await this.auditLogsService.log({
      userId: data.agencyId,
      action: 'AGENCY_EXTERNAL_BANK_LINKED',
      entityType: 'CybridExternalBankAccount',
      entityId: extAccount.id,
      details: { externalBankGuid, bankName: data.bankName, mask },
    });

    return extAccount;
  }

  /**
   * Link external bank using Plaid processor token
   */
  async linkWithPlaidProcessorToken(data: {
    agencyId: string;
    accountName: string;
    plaidProcessorToken: string;
    plaidInstitutionId?: string;
  }) {
    const user = await this.prisma.user.findUnique({
      where: { id: data.agencyId },
      include: { cybridCustomer: true },
    });

    if (!user || !user.cybridCustomer) {
      throw new NotFoundException(`Agency Cybrid Customer not found for ${data.agencyId}`);
    }

    if (!this.config.isConfigured) {
      throw new BadGatewayException('Cybrid configuration credentials missing in environment.');
    }

    let externalBankGuid: string;
    try {
      const resp = await this.cybridProvider.createExternalBankAccount({
        name: data.accountName,
        asset: 'USD',
        accountKind: 'plaid_processor_token',
        plaidProcessorToken: data.plaidProcessorToken,
        customerGuid: user.cybridCustomer.cybridCustomerGuid,
      });
      externalBankGuid = resp.guid;
    } catch (err) {
      this.logger.error(`Cybrid Plaid processor token link failed: ${err.message}`);
      throw new BadGatewayException(`Failed to link bank with Plaid processor token: ${err.message}`);
    }

    const extAccount = await this.prisma.cybridExternalBankAccount.create({
      data: {
        cybridExternalBankGuid: externalBankGuid,
        customerGuid: user.cybridCustomer.cybridCustomerGuid,
        agencyUserId: data.agencyId,
        bankName: data.accountName,
        accountKind: 'plaid_processor_token',
        plaidInstitutionId: data.plaidInstitutionId,
        asset: 'USD',
        status: 'completed',
      },
    });

    return extAccount;
  }
}

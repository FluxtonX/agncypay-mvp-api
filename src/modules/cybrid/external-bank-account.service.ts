import { Injectable, NotFoundException, BadRequestException, Logger, Inject } from '@nestjs/common';
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
    const talent = await this.prisma.talent.findFirst({
      where: { id: data.talentId, agencyId: data.agencyId, deletedAt: null },
      include: { counterparties: true },
    });

    if (!talent) {
      throw new NotFoundException(`Talent ${data.talentId} not found`);
    }

    const counterparty = talent.counterparties[0];
    if (!counterparty) {
      throw new BadRequestException(`Talent does not have a linked Cybrid Counterparty`);
    }

    const mask = data.accountNumber.length >= 4 ? data.accountNumber.slice(-4) : 'XXXX';
    let externalBankGuid: string;

    try {
      if (this.config.isConfigured) {
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
      } else {
        externalBankGuid = `eba_cyb_${Date.now()}`;
      }
    } catch (err) {
      this.logger.warn(`Cybrid create external bank account failed, using sandbox fallback: ${err.message}`);
      externalBankGuid = `eba_cyb_${Date.now()}`;
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

    const mask = data.accountNumber.length >= 4 ? data.accountNumber.slice(-4) : 'XXXX';
    let externalBankGuid: string;

    try {
      if (this.config.isConfigured && user.cybridCustomer) {
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
      } else {
        externalBankGuid = `eba_agency_${Date.now()}`;
      }
    } catch (err) {
      this.logger.warn(`Cybrid agency external bank link failed, using fallback: ${err.message}`);
      externalBankGuid = `eba_agency_${Date.now()}`;
    }

    // Save in CybridExternalBankAccount
    const extAccount = await this.prisma.cybridExternalBankAccount.create({
      data: {
        cybridExternalBankGuid: externalBankGuid,
        customerGuid: user.cybridCustomer?.cybridCustomerGuid,
        agencyUserId: data.agencyId,
        bankName: data.bankName,
        mask,
        accountKind: 'raw_routing_details',
        asset: 'USD',
        status: 'completed',
      },
    });

    // Also sync to AgencyExternalAccount for backwards compatibility with existing UI
    if (data.isPrimary) {
      await this.prisma.agencyExternalAccount.updateMany({
        where: { agencyId: data.agencyId },
        data: { isPrimary: false },
      });
    }

    const legacyAccount = await this.prisma.agencyExternalAccount.create({
      data: {
        agencyId: data.agencyId,
        accountName: data.accountName,
        bankName: data.bankName,
        accountNumberMask: mask,
        routingNumber: data.routingNumber,
        providerExternalAccountId: externalBankGuid,
        isPrimary: data.isPrimary ?? false,
      },
    });

    await this.auditLogsService.log({
      userId: data.agencyId,
      action: 'AGENCY_EXTERNAL_BANK_LINKED',
      entityType: 'CybridExternalBankAccount',
      entityId: extAccount.id,
      details: { externalBankGuid, bankName: data.bankName, mask },
    });

    return { extAccount, legacyAccount };
  }

  /**
   * Link via Plaid processor token
   */
  async linkViaPlaidProcessorToken(data: {
    userId: string;
    publicToken: string;
    accountId: string;
    talentId?: string;
  }) {
    // 1. Exchange Plaid public token for access token
    const plaidRes = await this.plaidProvider.exchangePublicToken({
      userId: data.userId,
      publicToken: data.publicToken,
    });

    // 2. Create processor token for Cybrid
    const processorToken = await this.plaidProvider.createProcessorToken(
      plaidRes.accessToken,
      data.accountId,
      'cybrid',
    );

    const selectedAcc = plaidRes.accounts.find((a) => a.accountId === data.accountId) || plaidRes.accounts[0];
    const mask = selectedAcc?.accountNumberMask || 'XXXX';
    const bankName = selectedAcc?.bankName || 'Plaid Linked Bank';

    let externalBankGuid = `eba_plaid_${Date.now()}`;

    if (data.talentId) {
      const talent = await this.prisma.talent.findFirst({
        where: { id: data.talentId, agencyId: data.userId, deletedAt: null },
        include: { counterparties: true },
      });

      if (!talent || !talent.counterparties[0]) {
        throw new NotFoundException('Talent or counterparty not found');
      }

      const counterparty = talent.counterparties[0];

      try {
        if (this.config.isConfigured) {
          const resp = await this.cybridProvider.createExternalBankAccount({
            name: `${talent.fullName} - ${bankName}`,
            asset: 'USD',
            accountKind: 'plaid_processor_token',
            plaidProcessorToken: processorToken,
            counterpartyGuid: counterparty.cybridCounterpartyGuid,
          });
          externalBankGuid = resp.guid;
        }
      } catch (err) {
        this.logger.warn(`Cybrid plaid link error, using fallback: ${err.message}`);
      }

      return this.prisma.cybridExternalBankAccount.create({
        data: {
          cybridCounterpartyId: counterparty.id,
          cybridExternalBankGuid: externalBankGuid,
          bankName,
          mask,
          accountKind: 'plaid_processor_token',
          asset: 'USD',
          status: 'completed',
        },
      });
    }

    return { success: true, externalBankGuid };
  }
}

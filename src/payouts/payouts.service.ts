import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ModernTreasuryProvider } from '../infrastructure/providers/modern-treasury/modern-treasury.provider';
import { AuditLogsService } from '../modules/audit-logs/audit-logs.service';
import { PayoutStatus } from '@prisma/client';

@Injectable()
export class PayoutsService {
  private readonly logger = new Logger(PayoutsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly modernTreasuryProvider: ModernTreasuryProvider,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  async addAgencyExternalAccount(data: {
    agencyId: string;
    accountName: string;
    bankName: string;
    accountNumber: string;
    routingNumber: string;
    isPrimary?: boolean;
  }) {
    const user = await this.prisma.user.findUnique({ where: { id: data.agencyId } });
    if (!user) {
      throw new NotFoundException(`Agency ${data.agencyId} not found`);
    }

    let counterpartyId = user.modernTreasuryCounterpartyId;
    if (!counterpartyId) {
      const cpResult = await this.modernTreasuryProvider.createCounterparty({
        name: user.fullName || 'Agency Partner',
        metadata: { agencyId: data.agencyId },
      });
      counterpartyId = cpResult.counterpartyId;
      await this.prisma.user.update({
        where: { id: data.agencyId },
        data: { modernTreasuryCounterpartyId: counterpartyId },
      });
    }

    const eaResult = await this.modernTreasuryProvider.createExternalAccount({
      counterpartyId,
      name: data.accountName,
      accountNumber: data.accountNumber,
      routingNumber: data.routingNumber,
    });

    const accountMask = data.accountNumber.length > 4 ? data.accountNumber.slice(-4) : data.accountNumber;

    if (data.isPrimary) {
      await this.prisma.agencyExternalAccount.updateMany({
        where: { agencyId: data.agencyId },
        data: { isPrimary: false },
      });
    }

    const extAccount = await this.prisma.agencyExternalAccount.create({
      data: {
        agencyId: data.agencyId,
        accountName: data.accountName,
        bankName: data.bankName,
        accountNumberMask: accountMask,
        routingNumber: data.routingNumber,
        modernTreasuryExternalAccountId: eaResult.externalAccountId,
        isPrimary: data.isPrimary ?? false,
      },
    });

    await this.auditLogsService.log({
      userId: data.agencyId,
      action: 'AGENCY_EXTERNAL_ACCOUNT_ADDED',
      entityType: 'AgencyExternalAccount',
      entityId: extAccount.id,
      details: { accountName: data.accountName, externalAccountId: eaResult.externalAccountId },
    });

    return extAccount;
  }

  async getAgencyExternalAccounts(agencyId: string) {
    return this.prisma.agencyExternalAccount.findMany({
      where: { agencyId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async requestPayout(data: {
    agencyId: string;
    amount: number;
    destinationExternalAccountId: string;
    paymentType?: 'ach' | 'wire' | 'rtp';
  }) {
    if (data.amount <= 0) {
      throw new BadRequestException('Payout amount must be greater than zero');
    }

    const user = await this.prisma.user.findUnique({ where: { id: data.agencyId } });
    if (!user || !user.modernTreasuryInternalAccountId) {
      throw new BadRequestException('Agency does not have an active Modern Treasury Internal Account');
    }

    // 1. Verify available balance via Modern Treasury Ledger
    let availableBalance = 25000; // default for simulated/unlinked
    if (user.modernTreasuryLedgerAccountId) {
      const ledgerBal = await this.modernTreasuryProvider.getLedgerAccountBalance(user.modernTreasuryLedgerAccountId);
      availableBalance = ledgerBal.postedBalance;
    }

    if (availableBalance < data.amount) {
      throw new BadRequestException(
        `Insufficient available balance ($${availableBalance.toFixed(2)}) for payout of $${data.amount.toFixed(2)}`,
      );
    }

    // 2. Verify destination External Account belongs to Agency
    const extAccount = await this.prisma.agencyExternalAccount.findFirst({
      where: {
        id: data.destinationExternalAccountId,
        agencyId: data.agencyId,
      },
    });

    if (!extAccount) {
      throw new NotFoundException('Destination external account not found for this Agency');
    }

    // 3. Create Payout database record
    const payout = await this.prisma.payout.create({
      data: {
        agencyId: data.agencyId,
        amount: data.amount,
        currency: 'USD',
        destinationExternalAccountId: extAccount.id,
        status: 'processing',
        metadata: {
          accountName: extAccount.accountName,
          paymentType: data.paymentType || 'ach',
        },
      },
    });

    // 4. Submit Payment Order via Modern Treasury
    const poResult = await this.modernTreasuryProvider.createPayout({
      payoutId: payout.id,
      agencyId: data.agencyId,
      amount: data.amount,
      currency: 'USD',
      originatingInternalAccountId: user.modernTreasuryInternalAccountId,
      receivingExternalAccountId: extAccount.modernTreasuryExternalAccountId,
      paymentType: data.paymentType || 'ach',
    });

    const updatedPayout = await this.prisma.payout.update({
      where: { id: payout.id },
      data: {
        paymentOrderId: poResult.paymentOrderId,
        status: poResult.status === 'success' ? 'disbursed' : 'processing',
      },
    });

    await this.auditLogsService.log({
      userId: data.agencyId,
      action: 'AGENCY_PAYOUT_INITIATED',
      entityType: 'Payout',
      entityId: payout.id,
      details: {
        amount: data.amount,
        paymentOrderId: poResult.paymentOrderId,
        destination: extAccount.accountName,
      },
    });

    return updatedPayout;
  }

  async getPayoutHistory(agencyId: string) {
    return this.prisma.payout.findMany({
      where: { agencyId },
      orderBy: { createdAt: 'desc' },
      include: { agency: true },
    });
  }

  async updatePayoutStatus(payoutId: string, status: PayoutStatus) {
    const payout = await this.prisma.payout.findUnique({ where: { id: payoutId } });
    if (!payout) {
      throw new NotFoundException(`Payout ${payoutId} not found`);
    }

    const updated = await this.prisma.payout.update({
      where: { id: payoutId },
      data: { status },
    });

    await this.auditLogsService.log({
      userId: payout.agencyId,
      action: `PAYOUT_STATUS_${status.toUpperCase()}`,
      entityType: 'Payout',
      entityId: payoutId,
      details: { previousStatus: payout.status, newStatus: status },
    });

    return updated;
  }
}

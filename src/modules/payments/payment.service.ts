import { Injectable, NotFoundException, BadRequestException, ForbiddenException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { LedgerService } from '../ledger/ledger.service';
import { CybridAccountService } from '../cybrid/cybrid-account.service';
import { PaymentStateService } from './payment-state.service';

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
    private readonly ledgerService: LedgerService,
    private readonly cybridAccountService: CybridAccountService,
    private readonly paymentStateService: PaymentStateService,
  ) {}

  async createPayment(data: {
    brandId: string;
    agencyId: string;
    amount: number;
    currency?: string;
    invoiceId?: string;
    paymentMethod?: string;
    metadata?: Record<string, any>;
  }) {
    if (data.amount <= 0) {
      throw new BadRequestException('Payment amount must be greater than 0');
    }

    const brand = await this.prisma.user.findUnique({ where: { id: data.brandId } });
    if (!brand) throw new NotFoundException(`Brand user ${data.brandId} not found`);

    let targetAgencyId = data.agencyId;
    let targetAmount = data.amount;

    if (data.invoiceId) {
      const invoice = await this.prisma.invoice.findUnique({ where: { id: data.invoiceId } });
      if (invoice) {
        targetAgencyId = invoice.agencyId;
        if (!targetAmount) targetAmount = Number(invoice.amount);
        // Mark invoice as processing
        await this.prisma.invoice.update({
          where: { id: data.invoiceId },
          data: { status: 'processing' },
        });
      }
    }

    const agency = await this.prisma.user.findUnique({ where: { id: targetAgencyId } });
    if (!agency) throw new NotFoundException(`Agency user ${targetAgencyId} not found`);

    // Ensure Agency has a Cybrid Deposit Bank Account for receiving external funds
    const depositAccount = await this.cybridAccountService.ensureDepositBankAccount(targetAgencyId);

    const paymentNumber = `PAY-${Math.floor(100000 + Math.random() * 900000)}`;

    const payment = await this.prisma.payment.create({
      data: {
        paymentNumber,
        brandId: data.brandId,
        agencyId: targetAgencyId,
        invoiceId: data.invoiceId,
        amount: targetAmount,
        currency: data.currency || 'USD',
        status: 'PENDING_FUNDING',
        paymentMethod: data.paymentMethod || 'ach',
        cybridDepositRef: depositAccount.uniqueMemoId || depositAccount.accountNumber,
        metadata: data.metadata || {},
      },
    });

    await this.auditLogsService.log({
      userId: data.brandId,
      action: 'PAYMENT_CREATED_PENDING_FUNDING',
      entityType: 'Payment',
      entityId: payment.id,
      details: {
        paymentNumber,
        amount: targetAmount,
        agencyId: targetAgencyId,
        depositRef: payment.cybridDepositRef,
      },
    });

    // Return payment with funding instructions for the Brand
    const fundingInstructions = await this.cybridAccountService.getAgencyFundingInstructions(targetAgencyId);

    return {
      payment,
      fundingInstructions,
    };
  }

  async markPaymentFunded(
    paymentId: string,
    details?: {
      transferGuid?: string;
      rawPayload?: any;
    },
  ) {
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (!payment) throw new NotFoundException(`Payment ${paymentId} not found`);

    // Transition to FUNDED
    await this.paymentStateService.transition(paymentId, 'FUNDED', {
      providerRef: details?.transferGuid,
    });

    // Record provider operation
    if (details?.transferGuid) {
      await this.prisma.providerOperation.upsert({
        where: {
          provider_operationType_operationGuid: {
            provider: 'cybrid',
            operationType: 'transfer',
            operationGuid: details.transferGuid,
          },
        },
        update: {
          status: 'completed',
          rawResponse: details.rawPayload || {},
        },
        create: {
          provider: 'cybrid',
          operationType: 'transfer',
          operationGuid: details.transferGuid,
          paymentId: payment.id,
          status: 'completed',
          rawResponse: details.rawPayload || {},
        },
      });

      await this.prisma.payment.update({
        where: { id: paymentId },
        data: { cybridTransferGuid: details.transferGuid },
      });
    }

    // ─── Double-Entry Ledger Posting ───
    // Debit: Platform clearing account (holding inbound funds)
    // Credit: Agency USD account (balance available to agency)
    await this.ledgerService.postJournalEntry({
      debitAccountCode: `CLEARING:CYBRID_DEPOSIT:USD`,
      creditAccountCode: `AGENCY:${payment.agencyId}:USD`,
      amount: Number(payment.amount),
      currency: payment.currency,
      referenceType: 'BRAND_PAYMENT_FUNDED',
      referenceId: payment.id,
      providerReference: details?.transferGuid || payment.cybridDepositRef || undefined,
      description: `Inbound funding for Payment ${payment.paymentNumber} from Brand`,
    });

    // Update invoice if linked — mark as funded (not disbursed, as payouts haven't happened yet)
    if (payment.invoiceId) {
      await this.prisma.invoice.update({
        where: { id: payment.invoiceId },
        data: { status: 'paid' },
      });
    }

    // Sync legacy Wallet balance
    try {
      const ledgerBal = await this.ledgerService.getAccountBalance(`AGENCY:${payment.agencyId}:USD`);
      const existing = await this.prisma.wallet.findFirst({ where: { userId: payment.agencyId } });
      if (existing) {
        await this.prisma.wallet.update({
          where: { id: existing.id },
          data: { balance: ledgerBal.balance },
        });
      } else {
        await this.prisma.wallet.create({
          data: {
            walletId: `WAL-AGY-${Math.floor(100000 + Math.random() * 900000)}`,
            userId: payment.agencyId,
            accountType: 'agency',
            balance: ledgerBal.balance,
            currency: 'USD',
            status: 'active',
          },
        });
      }
    } catch (err) {
      this.logger.warn(`Could not sync wallet for agency ${payment.agencyId}: ${err.message}`);
    }

    // NOTE: Payment stays in FUNDED state.
    // It transitions to COMPLETED only when the webhook handler confirms
    // the Cybrid transfer has fully settled.

    return await this.prisma.payment.findUnique({ where: { id: paymentId } });
  }

  async getPaymentById(paymentId: string, requestingUserId: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: {
        brand: { select: { id: true, fullName: true, email: true } },
        agency: { select: { id: true, fullName: true, email: true } },
        payouts: true,
        providerOperations: true,
      },
    });

    if (!payment) throw new NotFoundException(`Payment ${paymentId} not found`);

    // Strict agency / brand isolation check
    if (payment.brandId !== requestingUserId && payment.agencyId !== requestingUserId) {
      throw new ForbiddenException('Access denied to this payment record');
    }

    return payment;
  }

  async getPayments(userId: string) {
    return this.prisma.payment.findMany({
      where: {
        OR: [{ brandId: userId }, { agencyId: userId }],
      },
      include: {
        brand: { select: { id: true, fullName: true, email: true } },
        agency: { select: { id: true, fullName: true, email: true } },
        payouts: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getFundingInstructions(paymentId: string, requestingUserId: string) {
    const payment = await this.getPaymentById(paymentId, requestingUserId);
    return this.cybridAccountService.getAgencyFundingInstructions(payment.agencyId);
  }
}


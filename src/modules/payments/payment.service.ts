import {
  BadGatewayException,
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { PaymentOrchestrationService } from '../payment-orchestration/payment-orchestration.service';
import { PAYMENT_PROVIDER } from '../../core/interfaces/payment-provider.interface';
import type { PaymentProvider } from '../../core/interfaces/payment-provider.interface';
import { decryptText, encryptText } from '../../common/utils/crypto.util';
import { TalentBalancesService } from '../talent-balances/talent-balances.service';

@Injectable()
export class PaymentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
    private readonly orchestration: PaymentOrchestrationService,
    private readonly talentBalances: TalentBalancesService,
    @Inject(PAYMENT_PROVIDER) private readonly paymentProvider: PaymentProvider,
  ) {}

  private async ownedOrganization(userId: string, type: 'brand' | 'agency') {
    const organization = await this.prisma.organization.findFirst({
      where: {
        type,
        status: 'active',
        deletedAt: null,
        participants: {
          some: {
            status: 'active',
            participant: { users: { some: { userId } } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    if (!organization)
      throw new ForbiddenException(`Active ${type} organization is required`);
    return organization;
  }

  private async agencyOrganization(value: string) {
    const organization = await this.prisma.organization.findFirst({
      where: {
        type: 'agency',
        status: 'active',
        deletedAt: null,
        OR: [
          { id: value },
          {
            participants: {
              some: { participant: { users: { some: { userId: value } } } },
            },
          },
        ],
      },
    });
    if (!organization)
      throw new NotFoundException('Agency organization not found');
    return organization;
  }

  private async activeProviderParty(organizationId: string) {
    const mapping = await this.prisma.providerPartyMap.findFirst({
      where: {
        organizationId,
        provider: this.paymentProvider.name,
        status: 'active',
      },
      orderBy: { createdAt: 'asc' },
    });
    if (!mapping)
      throw new BadRequestException(
        'Agency payment-provider onboarding is not active',
      );
    return mapping;
  }

  private fundingInstructions(account: { metadata: unknown }) {
    const metadata = (account.metadata || {}) as Record<string, unknown>;
    const encrypted = String(metadata.fundingInstructionsEncrypted || '');
    if (!encrypted)
      throw new BadRequestException('Funding instructions are unavailable');
    try {
      return JSON.parse(decryptText(encrypted));
    } catch {
      throw new BadRequestException('Funding instructions could not be read');
    }
  }

  async provisionAgencyPaymentRails(
    userId: string,
    bank: {
      accountName: string;
      bankName: string;
      accountNumber: string;
      routingNumber: string;
      currency?: string;
    },
  ) {
    const agency = await this.ownedOrganization(userId, 'agency');
    const party = await this.activeProviderParty(agency.id);
    const currency = String(bank.currency || 'USD').toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency))
      throw new BadRequestException('Invalid currency');
    if (
      !bank.accountNumber ||
      bank.accountNumber.length < 4 ||
      !bank.routingNumber
    ) {
      throw new BadRequestException(
        'A valid account and routing number are required',
      );
    }
    const lastFour = bank.accountNumber.slice(-4);
    let destination = await this.prisma.financialAccount.findFirst({
      where: {
        organizationId: agency.id,
        type: 'external_bank',
        currency,
        lastFour,
        deletedAt: null,
        providerAccounts: {
          some: { provider: this.paymentProvider.name, status: 'active' },
        },
      },
      include: { providerAccounts: true },
    });
    if (!destination) {
      const recipient = await this.paymentProvider.createRecipient({
        partyId: party.externalId,
        name: bank.accountName,
        type: 'business',
        accountNumber: bank.accountNumber,
        routingNumber: bank.routingNumber,
        payoutRail: 'ach',
        metadata: { organizationId: agency.id },
      });
      destination = await this.prisma.$transaction(async (tx) => {
        await tx.financialAccount.updateMany({
          where: { organizationId: agency.id, type: 'external_bank', currency },
          data: { isPrimary: false },
        });
        return tx.financialAccount.create({
          data: {
            organizationId: agency.id,
            type: 'external_bank',
            status: 'ready',
            currency,
            displayName: bank.accountName,
            institutionName: bank.bankName,
            lastFour,
            isPrimary: true,
            providerAccounts: {
              create: {
                provider: this.paymentProvider.name,
                accountType: 'recipient',
                externalId: recipient.id,
                status: 'active',
              },
            },
          },
          include: { providerAccounts: true },
        });
      });
    }

    let collection = await this.prisma.financialAccount.findFirst({
      where: {
        organizationId: agency.id,
        type: 'virtual_account',
        currency,
        status: 'ready',
        deletedAt: null,
        providerAccounts: {
          some: { provider: this.paymentProvider.name, status: 'active' },
        },
      },
      include: { providerAccounts: true },
    });
    if (!collection) {
      const deposit = await this.paymentProvider.createDepositAccount({
        partyId: party.externalId,
        currency,
        accountType: 'collection',
        idempotencyKey: `agency-collection-${agency.id}-${currency}`,
        metadata: { organizationId: agency.id },
      });
      const encrypted = encryptText(
        JSON.stringify({
          accountNumber: deposit.accountNumber,
          routingNumber: deposit.routingNumber,
          bankName: deposit.bankName,
          beneficiaryName: deposit.beneficiaryName,
          currency: deposit.currency,
        }),
      );
      collection = await this.prisma.financialAccount.create({
        data: {
          organizationId: agency.id,
          type: 'virtual_account',
          status: 'ready',
          currency,
          displayName: `${currency} collection account`,
          institutionName: deposit.bankName,
          lastFour: deposit.accountNumber?.slice(-4),
          metadata: { fundingInstructionsEncrypted: encrypted },
          providerAccounts: {
            create: {
              provider: this.paymentProvider.name,
              accountType: 'collection',
              externalId: deposit.id,
              status: 'active',
            },
          },
        },
        include: { providerAccounts: true },
      });
    }
    await this.auditLogsService.log({
      userId,
      action: 'AGENCY_PAYMENT_RAILS_READY',
      entityType: 'Organization',
      entityId: agency.id,
      details: {
        provider: this.paymentProvider.name,
        destinationFinancialAccountId: destination.id,
        collectionFinancialAccountId: collection.id,
      },
    });
    return {
      agencyOrganizationId: agency.id,
      destinationAccount: {
        id: destination.id,
        bankName: destination.institutionName,
        lastFour: destination.lastFour,
        currency: destination.currency,
        status: destination.status,
      },
      collectionAccount: {
        id: collection.id,
        currency: collection.currency,
        status: collection.status,
        fundingInstructions: this.fundingInstructions(collection),
      },
    };
  }

  async createPayment(data: {
    brandId: string;
    agencyOrganizationId: string;
    amount: number | string;
    currency?: string;
    idempotencyKey: string;
    commercialDocumentVersionId?: string;
    purpose?: string;
    metadata?: Record<string, unknown>;
  }) {
    const brand = await this.ownedOrganization(data.brandId, 'brand');
    const agency = await this.agencyOrganization(data.agencyOrganizationId);
    const relationship = await this.prisma.organizationRelationship.findUnique({
      where: {
        sourceOrganizationId_targetOrganizationId_relationshipType: {
          sourceOrganizationId: agency.id,
          targetOrganizationId: brand.id,
          relationshipType: 'agency_brand',
        },
      },
    });
    if (relationship?.status !== 'active') {
      throw new ForbiddenException(
        'Brand is not active in the destination Agency network',
      );
    }
    const currency = String(data.currency || 'USD').toUpperCase();
    const destination = await this.prisma.financialAccount.findFirst({
      where: {
        organizationId: agency.id,
        type: 'external_bank',
        status: 'ready',
        currency,
        isPrimary: true,
        deletedAt: null,
        providerAccounts: {
          some: { provider: this.paymentProvider.name, status: 'active' },
        },
      },
    });
    if (!destination)
      throw new BadRequestException('Agency payout bank account is not ready');
    const collection = await this.prisma.financialAccount.findFirst({
      where: {
        organizationId: agency.id,
        type: 'virtual_account',
        status: 'ready',
        currency,
        deletedAt: null,
        providerAccounts: {
          some: { provider: this.paymentProvider.name, status: 'active' },
        },
      },
    });
    if (!collection)
      throw new BadRequestException('Agency collection account is not ready');
    if (!data.commercialDocumentVersionId) {
      throw new BadRequestException(
        'An approved CRM commercial invoice version is required',
      );
    }
    const version = await this.prisma.commercialDocumentVersion.findFirst({
      where: {
        id: data.commercialDocumentVersionId,
        validationStatus: 'valid',
        currency,
        totalAmount: new Prisma.Decimal(data.amount),
        approval: { status: 'approved' },
        document: {
          agencyOrganizationId: agency.id,
          payerOrganizationId: brand.id,
          documentType: 'invoice',
          deletedAt: null,
        },
      },
    });
    if (!version) {
      throw new BadRequestException(
        'Approved CRM invoice economics do not match this payment',
      );
    }
    const created = await this.orchestration.createInstruction({
      instructionType: 'brand_to_agency',
      sourceOrganizationId: brand.id,
      destinationOrganizationId: agency.id,
      destinationFinancialAccountId: destination.id,
      commercialDocumentVersionId: data.commercialDocumentVersionId,
      amount: data.amount,
      currency,
      providerRequired: true,
      purpose: data.purpose || 'commercial_invoice_payment',
      idempotencyScope: `${brand.id}:brand_to_agency`,
      idempotencyKey: data.idempotencyKey,
      requestedById: data.brandId,
      metadata: {
        ...(data.metadata || {}),
        collectionFinancialAccountId: collection.id,
        provider: this.paymentProvider.name,
      },
    });
    let instruction = created.instruction;
    if (!created.duplicate) {
      instruction = await this.orchestration.transitionInstruction(
        instruction.id,
        'validated',
        {
          actorId: data.brandId,
          reason: 'Brand/Agency relationship and payment rails validated',
        },
      );
      instruction = await this.orchestration.transitionInstruction(
        instruction.id,
        'awaiting_funding',
        {
          actorId: data.brandId,
        },
      );
      const inbound = await this.orchestration.beginProviderAttempt({
        instructionId: instruction.id,
        provider: this.paymentProvider.name,
        operationType: 'inbound_funding',
        idempotencyKey: `${instruction.id}:inbound`,
        requestPayload: {
          collectionFinancialAccountId: collection.id,
          amount: instruction.amount.toString(),
          currency,
        },
      });
      await this.orchestration.transitionAttempt(
        inbound.attempt.id,
        'submitted',
      );
      instruction = await this.orchestration.transitionInstruction(
        instruction.id,
        'funding_pending',
        {
          actorId: data.brandId,
          reason: 'Funding instructions issued',
        },
      );
    }
    await this.auditLogsService.log({
      userId: data.brandId,
      action: created.duplicate
        ? 'BRAND_PAYMENT_REPLAYED'
        : 'BRAND_PAYMENT_INITIATED',
      entityType: 'PaymentInstruction',
      entityId: instruction.id,
      details: {
        agencyOrganizationId: agency.id,
        amount: String(data.amount),
        currency,
      },
    });
    return {
      instruction,
      duplicate: created.duplicate,
      fundingInstructions: this.fundingInstructions(collection),
    };
  }

  async settleInboundFunding(
    instructionId: string,
    details: {
      providerReference: string;
      amount: number | string;
      currency: string;
      rawPayload?: Record<string, unknown>;
    },
    autoDisburse = true,
  ) {
    let instruction = await this.orchestration.getInstruction(instructionId);
    if (!instruction)
      throw new NotFoundException('Payment instruction not found');
    if (
      !['brand_to_agency', 'agency_to_talent_balance'].includes(
        instruction.instructionType,
      )
    ) {
      throw new BadRequestException(
        'Instruction does not accept inbound funding',
      );
    }
    if (['submitted', 'processing', 'settled'].includes(instruction.status))
      return instruction;
    if (!['funding_pending', 'funded'].includes(instruction.status)) {
      throw new BadRequestException(
        'Instruction is not awaiting inbound funding',
      );
    }
    if (
      !instruction.amount.equals(new Prisma.Decimal(details.amount)) ||
      instruction.currency !== details.currency.toUpperCase()
    ) {
      throw new BadRequestException(
        'Provider funding amount or currency does not match instruction',
      );
    }
    if (instruction.status === 'funding_pending') {
      const attempt = instruction.attempts.find(
        (item) =>
          item.operationType === 'inbound_funding' &&
          ['submitted', 'accepted', 'unknown'].includes(item.status),
      );
      if (!attempt)
        throw new BadRequestException(
          'Active inbound funding attempt not found',
        );
      await this.orchestration.transitionAttempt(attempt.id, 'settled', {
        externalReference: details.providerReference,
        responsePayload: details.rawPayload,
      });
      await this.orchestration.transitionInstruction(instruction.id, 'funded', {
        reason: 'Inbound Brand funds settled at payment provider',
        metadata: { providerReference: details.providerReference },
      });
    }
    if (instruction.instructionType === 'brand_to_agency' && autoDisburse) {
      return this.executeAgencyDisbursement(instruction.id);
    }
    if (instruction.instructionType === 'agency_to_talent_balance') {
      await this.talentBalances.creditFundedInstruction(instruction.id);
    }
    return this.orchestration.getInstruction(instruction.id);
  }

  async executeAgencyDisbursement(instructionId: string) {
    let instruction = await this.orchestration.getInstruction(instructionId);
    if (!instruction)
      throw new NotFoundException('Payment instruction not found');
    if (['submitted', 'processing', 'settled'].includes(instruction.status))
      return instruction;
    if (instruction.status === 'funded') {
      await this.orchestration.transitionInstruction(
        instruction.id,
        'awaiting_provider',
        {
          reason: 'Inbound funds available for Agency disbursement',
        },
      );
      instruction = await this.orchestration.getInstruction(instruction.id);
    }
    if (instruction!.status !== 'awaiting_provider') {
      throw new BadRequestException(
        'Payment is not ready for Agency disbursement',
      );
    }
    const party = await this.activeProviderParty(
      instruction!.destinationOrganizationId!,
    );
    const destination = await this.prisma.financialAccount.findUnique({
      where: { id: instruction!.destinationFinancialAccountId! },
      include: { providerAccounts: true },
    });
    const accountMap = destination?.providerAccounts.find(
      (item) =>
        item.provider === this.paymentProvider.name && item.status === 'active',
    );
    if (!destination || destination.status !== 'ready' || !accountMap) {
      throw new BadRequestException(
        'Agency destination account is unavailable',
      );
    }
    const begun = await this.orchestration.beginProviderAttempt({
      instructionId: instruction!.id,
      provider: this.paymentProvider.name,
      operationType: 'agency_disbursement',
      idempotencyKey: `${instruction!.id}:agency-disbursement`,
      requestPayload: {
        partyId: party.externalId,
        recipientId: accountMap.externalId,
        amount: instruction!.amount.toString(),
        currency: instruction!.currency,
      },
    });
    await this.orchestration.transitionAttempt(begun.attempt.id, 'submitted');
    await this.orchestration.transitionInstruction(
      instruction!.id,
      'submitted',
      {
        reason: 'Agency disbursement submitted to payment provider',
      },
    );
    try {
      const result = await this.paymentProvider.createTransfer({
        partyId: party.externalId,
        recipientId: accountMap.externalId,
        amount: Number(instruction!.amount),
        currency: instruction!.currency,
        purpose: instruction!.purpose,
        reference: instruction!.id,
        idempotencyKey: `${instruction!.id}:agency-disbursement`,
        metadata: { paymentInstructionId: instruction!.id },
      });
      if (result.status === 'completed') {
        await this.orchestration.transitionAttempt(
          begun.attempt.id,
          'settled',
          {
            externalReference: result.id,
            responsePayload: result as Record<string, unknown>,
          },
        );
        await this.orchestration.transitionInstruction(
          instruction!.id,
          'settled',
          {
            reason: 'Agency disbursement settled',
            metadata: { providerReference: result.id },
          },
        );
      } else if (['pending', 'processing'].includes(result.status)) {
        await this.orchestration.transitionAttempt(
          begun.attempt.id,
          'accepted',
          {
            externalReference: result.id,
            responsePayload: result as Record<string, unknown>,
          },
        );
        await this.orchestration.transitionInstruction(
          instruction!.id,
          'processing',
          {
            reason: 'Agency disbursement accepted by payment provider',
            metadata: { providerReference: result.id },
          },
        );
      } else {
        throw new Error(
          result.failureCode || `Provider returned ${result.status}`,
        );
      }
    } catch (error: any) {
      await this.orchestration.transitionAttempt(begun.attempt.id, 'failed', {
        errorCode: 'PROVIDER_TRANSFER_FAILED',
        errorMessage: error.message,
      });
      await this.orchestration.transitionInstruction(
        instruction!.id,
        'failed',
        {
          failureCode: 'AGENCY_DISBURSEMENT_FAILED',
          reason: error.message,
        },
      );
      throw new BadGatewayException(
        `Agency disbursement failed: ${error.message}`,
      );
    }
    return this.orchestration.getInstruction(instruction!.id);
  }

  async getPaymentById(paymentId: string, requestingUserId: string) {
    const organizationIds = await this.prisma.organizationParticipant.findMany({
      where: {
        status: 'active',
        participant: { users: { some: { userId: requestingUserId } } },
      },
      select: { organizationId: true },
    });
    const allowed = new Set(organizationIds.map((item) => item.organizationId));
    const payment = await this.orchestration.getInstruction(paymentId);
    if (!payment) throw new NotFoundException('Payment instruction not found');
    if (
      !allowed.has(payment.sourceOrganizationId || '') &&
      !allowed.has(payment.destinationOrganizationId || '')
    ) {
      throw new ForbiddenException('Access denied to this payment record');
    }
    return payment;
  }

  async getPayments(userId: string) {
    const organizations = await this.prisma.organizationParticipant.findMany({
      where: { status: 'active', participant: { users: { some: { userId } } } },
      select: { organizationId: true },
    });
    const ids = organizations.map((item) => item.organizationId);
    return this.prisma.paymentInstruction.findMany({
      where: {
        instructionType: 'brand_to_agency',
        OR: [
          { sourceOrganizationId: { in: ids } },
          { destinationOrganizationId: { in: ids } },
        ],
      },
      include: { attempts: { orderBy: { attemptNumber: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getFundingInstructions(paymentId: string, requestingUserId: string) {
    const payment = await this.getPaymentById(paymentId, requestingUserId);
    const metadata = (payment.metadata || {}) as Record<string, unknown>;
    const collectionId = String(metadata.collectionFinancialAccountId || '');
    const collection = await this.prisma.financialAccount.findUnique({
      where: { id: collectionId },
    });
    if (!collection)
      throw new NotFoundException('Collection account not found');
    return {
      paymentInstructionId: payment.id,
      amount: payment.amount,
      currency: payment.currency,
      fundingInstructions: this.fundingInstructions(collection),
    };
  }
}

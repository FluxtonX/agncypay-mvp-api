import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PaymentOrchestrationService } from '../payment-orchestration/payment-orchestration.service';
import { PAYMENT_PROVIDER } from '../../core/interfaces/payment-provider.interface';
import type { PaymentProvider } from '../../core/interfaces/payment-provider.interface';
import { decryptText } from '../../common/utils/crypto.util';

@Injectable()
export class TalentFundingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orchestration: PaymentOrchestrationService,
    @Inject(PAYMENT_PROVIDER) private readonly paymentProvider: PaymentProvider,
  ) {}

  private readFundingInstructions(metadataValue: unknown) {
    const metadata = (metadataValue || {}) as Record<string, unknown>;
    const encrypted = String(metadata.fundingInstructionsEncrypted || '');
    if (!encrypted)
      throw new BadRequestException(
        'Agency funding instructions are unavailable',
      );
    try {
      return JSON.parse(decryptText(encrypted));
    } catch {
      throw new BadRequestException(
        'Agency funding instructions could not be read',
      );
    }
  }

  async prepareApprovedPayable(userId: string, versionId: string) {
    const version = await this.prisma.commercialDocumentVersion.findUnique({
      where: { id: versionId },
      include: {
        document: true,
        approval: true,
        allocations: { orderBy: { externalAllocationId: 'asc' } },
      },
    });
    if (!version)
      throw new NotFoundException('Commercial document version not found');
    const membership = await this.prisma.organizationParticipant.findFirst({
      where: {
        organizationId: version.document.agencyOrganizationId,
        status: 'active',
        participant: { users: { some: { userId } } },
      },
    });
    if (!membership)
      throw new ForbiddenException(
        'Payable is outside your Agency organization',
      );
    if (
      version.document.documentType !== 'payable' ||
      version.validationStatus !== 'valid' ||
      version.versionNumber !== version.document.currentVersionNumber ||
      version.approval?.status !== 'approved'
    ) {
      throw new BadRequestException(
        'Only the current, valid, approved payable version can be funded',
      );
    }
    if (!version.allocations.length)
      throw new BadRequestException('Payable has no allocation lines');
    if (
      version.allocations.some(
        (allocation) =>
          allocation.status !== 'valid' ||
          !allocation.beneficiaryParticipantId ||
          allocation.currency !== version.currency,
      )
    ) {
      throw new BadRequestException(
        'Every payable allocation must be valid and mapped',
      );
    }

    const collection = await this.prisma.financialAccount.findFirst({
      where: {
        organizationId: version.document.agencyOrganizationId,
        type: 'virtual_account',
        status: 'ready',
        currency: version.currency,
        deletedAt: null,
        providerAccounts: {
          some: { provider: this.paymentProvider.name, status: 'active' },
        },
      },
    });
    if (!collection)
      throw new BadRequestException('Agency collection account is not ready');

    const results = [];
    for (const allocation of version.allocations) {
      const created = await this.orchestration.createInstruction({
        instructionType: 'agency_to_talent_balance',
        sourceOrganizationId: version.document.agencyOrganizationId,
        destinationParticipantId: allocation.beneficiaryParticipantId!,
        commercialDocumentVersionId: version.id,
        payableAllocationId: allocation.id,
        amount: allocation.amount,
        currency: allocation.currency,
        providerRequired: true,
        purpose: 'fund_talent_ap_balance',
        idempotencyScope: `${version.document.agencyOrganizationId}:payable-allocation`,
        idempotencyKey: allocation.id,
        requestedById: userId,
        metadata: {
          collectionFinancialAccountId: collection.id,
          provider: this.paymentProvider.name,
          externalAllocationId: allocation.externalAllocationId,
        },
      });
      let instruction = created.instruction;
      if (instruction.status === 'requested') {
        instruction = await this.orchestration.transitionInstruction(
          instruction.id,
          'validated',
          {
            actorId: userId,
            reason: 'Approved CRM allocation preserved without recalculation',
          },
        );
      }
      if (instruction.status === 'validated') {
        instruction = await this.orchestration.transitionInstruction(
          instruction.id,
          'awaiting_funding',
          {
            actorId: userId,
          },
        );
      }
      if (instruction.status === 'awaiting_funding') {
        const inbound = await this.orchestration.beginProviderAttempt({
          instructionId: instruction.id,
          provider: this.paymentProvider.name,
          operationType: 'inbound_funding',
          idempotencyKey: `${instruction.id}:inbound`,
          requestPayload: {
            collectionFinancialAccountId: collection.id,
            amount: instruction.amount.toString(),
            currency: instruction.currency,
          },
        });
        if (inbound.attempt.status === 'requested') {
          await this.orchestration.transitionAttempt(
            inbound.attempt.id,
            'submitted',
          );
        }
        instruction = await this.orchestration.transitionInstruction(
          instruction.id,
          'funding_pending',
          {
            actorId: userId,
            reason: 'Agency funding instructions issued for CRM allocation',
          },
        );
      }
      results.push({
        instructionId: instruction.id,
        status: instruction.status,
        beneficiaryParticipantId: allocation.beneficiaryParticipantId,
        externalAllocationId: allocation.externalAllocationId,
        amount: instruction.amount,
        currency: instruction.currency,
        duplicate: created.duplicate,
      });
    }
    return {
      commercialDocumentVersionId: version.id,
      fundingInstructions: this.readFundingInstructions(collection.metadata),
      transferPolicy:
        'Send one bank transfer per instruction using its instructionId as the reference.',
      instructions: results,
    };
  }
}

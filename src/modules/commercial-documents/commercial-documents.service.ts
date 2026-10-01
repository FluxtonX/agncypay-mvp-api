import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

interface AllocationInput {
  externalAllocationId: string;
  amount: number | string;
  currency?: string;
  participantId?: string;
  talentId?: string;
  talentExternalId?: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class CommercialDocumentsService {
  constructor(private readonly prisma: PrismaService) {}

  private async resolvePayerOrganization(
    connection: {
      organizationId: string | null;
      connectorKey: string;
      externalTenantId: string;
    },
    data: Record<string, any>,
  ) {
    const directId = data.payerOrganizationId || data.brandOrganizationId;
    if (directId) {
      return this.prisma.organization.findFirst({
        where: {
          id: String(directId),
          type: 'brand',
          status: 'active',
          relationshipsTo: {
            some: {
              sourceOrganizationId: connection.organizationId!,
              relationshipType: 'agency_brand',
              status: 'active',
            },
          },
        },
      });
    }
    const externalId =
      data.payerExternalId || data.brandExternalId || data.customerExternalId;
    if (!externalId) return null;
    const identity = await this.prisma.externalIdentityMap.findUnique({
      where: {
        sourceSystem_sourceTenantId_externalType_externalId: {
          sourceSystem: connection.connectorKey,
          sourceTenantId: connection.externalTenantId,
          externalType: 'brand',
          externalId: String(externalId),
        },
      },
      include: { organization: true },
    });
    return identity?.organization?.type === 'brand' &&
      identity.organization.status === 'active'
      ? identity.organization
      : null;
  }

  private async resolveParticipant(
    connection: {
      organizationId: string | null;
      connectorKey: string;
      externalTenantId: string;
    },
    allocation: AllocationInput,
  ) {
    const directId = allocation.participantId || allocation.talentId;
    if (directId) {
      return this.prisma.participant.findFirst({
        where: {
          id: directId,
          organizations: {
            some: {
              organizationId: connection.organizationId!,
              status: 'active',
            },
          },
        },
      });
    }
    if (!allocation.talentExternalId) return null;
    const identity = await this.prisma.externalIdentityMap.findUnique({
      where: {
        sourceSystem_sourceTenantId_externalType_externalId: {
          sourceSystem: connection.connectorKey,
          sourceTenantId: connection.externalTenantId,
          externalType: 'talent',
          externalId: allocation.talentExternalId,
        },
      },
      include: { participant: true },
    });
    if (!identity?.participant) return null;
    return this.prisma.participant.findFirst({
      where: {
        id: identity.participant.id,
        organizations: {
          some: {
            organizationId: connection.organizationId!,
            status: 'active',
          },
        },
      },
    });
  }

  async ingestPayable(input: {
    connection: {
      id: string;
      organizationId: string | null;
      connectorKey: string;
      externalTenantId: string;
    };
    sourceEvent: { id: string; externalEventId: string; payloadHash: string };
    data: Record<string, any>;
  }) {
    if (!input.connection.organizationId) {
      throw new BadRequestException(
        'Payable source connection must belong to an organization',
      );
    }
    const externalDocumentId = String(
      input.data.externalDocumentId ||
        input.data.externalDealId ||
        input.data.dealId ||
        input.data.id ||
        '',
    );
    if (!externalDocumentId) {
      throw new BadRequestException(
        'Stable CRM payable externalDocumentId is required',
      );
    }

    const documentType =
      input.data.documentType === 'invoice' ? 'invoice' : 'payable';
    const currency = String(input.data.currency || 'USD').toUpperCase();
    const totalAmount = new Prisma.Decimal(
      input.data.amount ?? input.data.totalAmount ?? 0,
    );
    const sourceVersion = String(
      input.data.version || input.sourceEvent.externalEventId,
    );
    const payerOrganization =
      documentType === 'invoice'
        ? await this.resolvePayerOrganization(input.connection, input.data)
        : null;
    const rawAllocations: AllocationInput[] =
      documentType === 'invoice'
        ? []
        : Array.isArray(input.data.allocations)
          ? input.data.allocations.map((allocation: any, index: number) => ({
              ...allocation,
              externalAllocationId: String(
                allocation.externalAllocationId || allocation.id || index + 1,
              ),
              currency: String(allocation.currency || currency).toUpperCase(),
            }))
          : [];

    const findings: Array<{
      code: string;
      severity: 'error' | 'warning' | 'info';
      field?: string;
      message: string;
      details?: Record<string, unknown>;
    }> = [];
    if (!/^[A-Z]{3}$/.test(currency)) {
      findings.push({
        code: 'INVALID_CURRENCY',
        severity: 'error',
        field: 'currency',
        message: 'Currency must be an ISO-style three-letter code',
      });
    }
    if (totalAmount.lte(0)) {
      findings.push({
        code: 'INVALID_TOTAL',
        severity: 'error',
        field: 'amount',
        message: 'Payable total must be greater than zero',
      });
    }
    if (documentType === 'payable' && rawAllocations.length === 0) {
      findings.push({
        code: 'MISSING_ALLOCATIONS',
        severity: 'error',
        field: 'allocations',
        message: 'At least one CRM allocation is required',
      });
    }
    if (documentType === 'invoice' && !payerOrganization) {
      findings.push({
        code: 'UNMAPPED_PAYER',
        severity: 'error',
        field: 'payer',
        message:
          'Invoice payer could not be mapped to an active Brand in the Agency network',
      });
    }

    const allocations = [] as Array<
      AllocationInput & {
        amountDecimal: Prisma.Decimal;
        beneficiaryParticipantId: string | null;
        valid: boolean;
      }
    >;
    for (const allocation of rawAllocations) {
      const amount = new Prisma.Decimal(allocation.amount ?? 0);
      const allocationCurrency = String(
        allocation.currency || currency,
      ).toUpperCase();
      const participant = await this.resolveParticipant(
        input.connection,
        allocation,
      );
      let valid = true;
      if (amount.lte(0)) {
        valid = false;
        findings.push({
          code: 'INVALID_ALLOCATION_AMOUNT',
          severity: 'error',
          field: `allocations.${allocation.externalAllocationId}.amount`,
          message: 'Allocation amount must be greater than zero',
        });
      }
      if (allocationCurrency !== currency) {
        valid = false;
        findings.push({
          code: 'ALLOCATION_CURRENCY_MISMATCH',
          severity: 'error',
          field: `allocations.${allocation.externalAllocationId}.currency`,
          message: 'Allocation currency must equal document currency',
        });
      }
      if (!participant) {
        valid = false;
        findings.push({
          code: 'UNMAPPED_BENEFICIARY',
          severity: 'error',
          field: `allocations.${allocation.externalAllocationId}.beneficiary`,
          message:
            'Allocation beneficiary could not be mapped to an AP participant',
        });
      }
      allocations.push({
        ...allocation,
        currency: allocationCurrency,
        amountDecimal: amount,
        beneficiaryParticipantId: participant?.id || null,
        valid,
      });
    }

    const allocationTotal = allocations.reduce(
      (sum, allocation) => sum.add(allocation.amountDecimal),
      new Prisma.Decimal(0),
    );
    if (documentType === 'payable' && !allocationTotal.equals(totalAmount)) {
      findings.push({
        code: 'ALLOCATION_TOTAL_MISMATCH',
        severity: 'error',
        field: 'allocations',
        message: 'CRM allocation total must exactly equal the payable total',
        details: {
          payableTotal: totalAmount.toString(),
          allocationTotal: allocationTotal.toString(),
        },
      });
    }
    const validationStatus = findings.some(
      (finding) => finding.severity === 'error',
    )
      ? 'invalid'
      : 'valid';

    return this.prisma.$transaction(async (tx) => {
      const document = await tx.commercialDocument.upsert({
        where: {
          sourceConnectionId_documentType_externalDocumentId: {
            sourceConnectionId: input.connection.id,
            documentType,
            externalDocumentId,
          },
        },
        update: { payerOrganizationId: payerOrganization?.id },
        create: {
          sourceConnectionId: input.connection.id,
          agencyOrganizationId: input.connection.organizationId!,
          payerOrganizationId: payerOrganization?.id,
          externalDocumentId,
          documentType,
        },
      });
      const existing = await tx.commercialDocumentVersion.findUnique({
        where: {
          documentId_sourceVersion: { documentId: document.id, sourceVersion },
        },
        include: {
          allocations: true,
          findings: true,
          approval: true,
          document: true,
        },
      });
      if (existing) {
        if (existing.payloadHash !== input.sourceEvent.payloadHash) {
          throw new ConflictException(
            'CRM sourceVersion was reused with a different payload',
          );
        }
        return {
          document: existing.document,
          version: existing,
          duplicate: true,
        };
      }
      const versionNumber = document.currentVersionNumber + 1;
      const version = await tx.commercialDocumentVersion.create({
        data: {
          documentId: document.id,
          sourceEventId: input.sourceEvent.id,
          versionNumber,
          sourceVersion,
          payloadHash: input.sourceEvent.payloadHash,
          currency,
          totalAmount,
          effectiveAt: input.data.effectiveAt
            ? new Date(input.data.effectiveAt)
            : undefined,
          dueAt:
            input.data.dueAt || input.data.dueDate
              ? new Date(input.data.dueAt || input.data.dueDate)
              : undefined,
          validationStatus,
          rawPayload: input.data,
          allocations: {
            create: allocations.map((allocation) => ({
              externalAllocationId: allocation.externalAllocationId,
              beneficiaryParticipantId: allocation.beneficiaryParticipantId,
              amount: allocation.amountDecimal,
              currency: allocation.currency!,
              status: allocation.valid ? 'valid' : 'invalid',
              metadata: (allocation.metadata || {}) as any,
            })),
          },
          findings: {
            create: findings.map((finding) => ({
              code: finding.code,
              severity: finding.severity,
              field: finding.field,
              message: finding.message,
              details: (finding.details || {}) as any,
            })),
          },
          approval:
            validationStatus === 'valid'
              ? { create: { status: 'pending' } }
              : undefined,
        },
        include: { allocations: true, findings: true, approval: true },
      });
      const updatedDocument = await tx.commercialDocument.update({
        where: { id: document.id },
        data: { currentVersionNumber: versionNumber, status: validationStatus },
      });
      return { document: updatedDocument, version, duplicate: false };
    });
  }

  async listForAgency(userId: string) {
    const organization = await this.prisma.organization.findFirst({
      where: {
        type: 'agency',
        participants: {
          some: {
            status: 'active',
            participant: { users: { some: { userId } } },
          },
        },
      },
    });
    if (!organization)
      throw new ForbiddenException('Agency organization not found');
    return this.prisma.commercialDocument.findMany({
      where: { agencyOrganizationId: organization.id, deletedAt: null },
      include: {
        versions: {
          orderBy: { versionNumber: 'desc' },
          take: 1,
          include: { allocations: true, findings: true, approval: true },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async listForBrand(userId: string) {
    const organization = await this.prisma.organization.findFirst({
      where: {
        type: 'brand',
        status: 'active',
        participants: {
          some: {
            status: 'active',
            participant: { users: { some: { userId } } },
          },
        },
      },
      select: { id: true },
    });
    if (!organization)
      throw new ForbiddenException('Brand organization not found');
    return this.prisma.commercialDocument.findMany({
      where: {
        payerOrganizationId: organization.id,
        documentType: 'invoice',
        deletedAt: null,
      },
      include: {
        agencyOrganization: { select: { id: true, name: true } },
        versions: {
          orderBy: { versionNumber: 'desc' },
          take: 1,
          include: { findings: true, approval: true },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async listPendingForAgency(userId: string) {
    const organization = await this.prisma.organization.findFirst({
      where: {
        type: 'agency',
        participants: {
          some: {
            status: 'active',
            participant: { users: { some: { userId } } },
          },
        },
      },
      select: { id: true },
    });
    if (!organization)
      throw new ForbiddenException('Agency organization not found');
    const documents = await this.prisma.commercialDocument.findMany({
      where: {
        agencyOrganizationId: organization.id,
        status: 'valid',
        deletedAt: null,
        versions: { some: { approval: { status: 'pending' } } },
      },
      include: {
        versions: {
          orderBy: { versionNumber: 'desc' },
          take: 1,
          include: { allocations: true, findings: true, approval: true },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });
    const currentPending = documents.filter(
      (document) => document.versions[0]?.approval?.status === 'pending',
    );
    const totalsByCurrency = currentPending.reduce<Record<string, string>>(
      (totals, document) => {
        const version = document.versions[0];
        const current = new Prisma.Decimal(totals[version.currency] || 0);
        totals[version.currency] = current.add(version.totalAmount).toString();
        return totals;
      },
      {},
    );
    return {
      count: currentPending.length,
      totalsByCurrency,
      payables: currentPending,
    };
  }

  async decide(
    userId: string,
    versionId: string,
    decision: 'approved' | 'rejected',
    reason?: string,
  ) {
    const version = await this.prisma.commercialDocumentVersion.findUnique({
      where: { id: versionId },
      include: { document: true, approval: true },
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
        'Commercial document is outside your organization',
      );
    if (version.versionNumber !== version.document.currentVersionNumber) {
      throw new ConflictException(
        'Only the current commercial document version can be decided',
      );
    }
    if (version.validationStatus !== 'valid') {
      throw new BadRequestException(
        'Invalid commercial documents cannot be approved',
      );
    }
    if (!version.approval || version.approval.status !== 'pending') {
      throw new ConflictException(
        'Commercial document version is not awaiting a decision',
      );
    }
    return this.prisma.commercialApproval.update({
      where: { documentVersionId: version.id },
      data: {
        status: decision,
        reason,
        decidedById: userId,
        decidedAt: new Date(),
      },
    });
  }
}

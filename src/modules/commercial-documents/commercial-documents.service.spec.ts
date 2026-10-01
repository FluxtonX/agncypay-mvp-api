import { ConflictException } from '@nestjs/common';
import { CommercialDocumentsService } from './commercial-documents.service';

function createPrismaMock() {
  const prisma: any = {
    organization: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'brand-organization-1',
        type: 'brand',
        status: 'active',
      }),
    },
    participant: { findFirst: jest.fn().mockResolvedValue({ id: 'talent-1' }) },
    externalIdentityMap: { findUnique: jest.fn() },
    commercialDocument: {
      upsert: jest.fn().mockResolvedValue({
        id: 'document-1',
        currentVersionNumber: 0,
      }),
      update: jest.fn().mockImplementation(({ data }) => ({
        id: 'document-1',
        ...data,
      })),
    },
    commercialDocumentVersion: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(({ data }) => ({
        id: 'version-1',
        ...data,
        allocations: data.allocations.create,
        findings: data.findings.create,
        approval: data.approval?.create || null,
      })),
    },
  };
  prisma.$transaction = jest
    .fn()
    .mockImplementation((callback) => callback(prisma));
  return prisma;
}

const connection = {
  id: 'connection-1',
  organizationId: 'organization-1',
  connectorKey: 'crm',
  externalTenantId: 'tenant-1',
};

describe('CommercialDocumentsService', () => {
  it('preserves a valid CRM allocation and creates a pending approval', async () => {
    const prisma = createPrismaMock();
    const service = new CommercialDocumentsService(prisma);

    const result = await service.ingestPayable({
      connection,
      sourceEvent: {
        id: 'event-1',
        externalEventId: 'event-1',
        payloadHash: 'hash-1',
      },
      data: {
        externalDocumentId: 'payable-1',
        version: '1',
        amount: '125.50',
        currency: 'usd',
        allocations: [
          {
            externalAllocationId: 'line-1',
            talentId: 'talent-1',
            amount: '125.50',
          },
        ],
      },
    });

    expect(result.version.validationStatus).toBe('valid');
    expect(result.version.approval).toEqual({ status: 'pending' });
    expect(result.version.allocations[0]).toMatchObject({
      beneficiaryParticipantId: 'talent-1',
      currency: 'USD',
      status: 'valid',
    });
    expect(result.version.allocations[0].amount.toString()).toBe('125.5');
  });

  it('records an allocation mismatch as invalid without an approval', async () => {
    const prisma = createPrismaMock();
    const service = new CommercialDocumentsService(prisma);

    const result = await service.ingestPayable({
      connection,
      sourceEvent: {
        id: 'event-2',
        externalEventId: 'event-2',
        payloadHash: 'hash-2',
      },
      data: {
        externalDocumentId: 'payable-1',
        version: '2',
        amount: '100',
        currency: 'USD',
        allocations: [
          {
            externalAllocationId: 'line-1',
            talentId: 'talent-1',
            amount: '90',
          },
        ],
      },
    });

    expect(result.version.validationStatus).toBe('invalid');
    expect(result.version.approval).toBeNull();
    expect(result.version.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'ALLOCATION_TOTAL_MISMATCH',
          severity: 'error',
        }),
      ]),
    );
  });

  it('maps a CRM invoice to its Brand payer without inventing allocations', async () => {
    const prisma = createPrismaMock();
    const service = new CommercialDocumentsService(prisma);

    const result = await service.ingestPayable({
      connection,
      sourceEvent: {
        id: 'event-invoice-1',
        externalEventId: 'event-invoice-1',
        payloadHash: 'hash-invoice-1',
      },
      data: {
        documentType: 'invoice',
        externalDocumentId: 'invoice-1',
        version: '1',
        payerOrganizationId: 'brand-organization-1',
        amount: '500',
        currency: 'USD',
      },
    });

    expect(result.version.validationStatus).toBe('valid');
    expect(result.version.allocations).toEqual([]);
    expect(prisma.commercialDocument.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          documentType: 'invoice',
          payerOrganizationId: 'brand-organization-1',
        }),
      }),
    );
  });

  it('does not invent a Talent allocation when a CRM payable omits allocations', async () => {
    const prisma = createPrismaMock();
    const service = new CommercialDocumentsService(prisma);

    const result = await service.ingestPayable({
      connection,
      sourceEvent: {
        id: 'event-missing-allocations',
        externalEventId: 'event-missing-allocations',
        payloadHash: 'missing-allocations-hash',
      },
      data: {
        externalDocumentId: 'payable-without-allocations',
        amount: '100',
        talentId: 'talent-1',
      },
    });

    expect(result.version.validationStatus).toBe('invalid');
    expect(result.version.allocations).toEqual([]);
    expect(result.version.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'MISSING_ALLOCATIONS' }),
      ]),
    );
  });

  it('rejects a reused source version with different content', async () => {
    const prisma = createPrismaMock();
    prisma.commercialDocumentVersion.findUnique.mockResolvedValue({
      payloadHash: 'original-hash',
      allocations: [],
      findings: [],
      approval: null,
      document: { id: 'document-1' },
    });
    const service = new CommercialDocumentsService(prisma);

    await expect(
      service.ingestPayable({
        connection,
        sourceEvent: {
          id: 'event-3',
          externalEventId: 'event-3',
          payloadHash: 'changed-hash',
        },
        data: {
          externalDocumentId: 'payable-1',
          version: '1',
          amount: '100',
          allocations: [
            {
              externalAllocationId: 'line-1',
              talentId: 'talent-1',
              amount: '100',
            },
          ],
        },
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

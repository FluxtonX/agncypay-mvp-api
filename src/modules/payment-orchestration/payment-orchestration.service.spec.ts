import { BadRequestException, ConflictException } from '@nestjs/common';
import { PaymentOrchestrationService } from './payment-orchestration.service';

describe('PaymentOrchestrationService', () => {
  it('enforces explicit terminal and recovery transitions', () => {
    const service = new PaymentOrchestrationService({} as any);

    expect(service.canTransition('requested', 'validated')).toBe(true);
    expect(service.canTransition('validated', 'settled')).toBe(true);
    expect(service.canTransition('settled', 'returned')).toBe(true);
    expect(service.canTransition('settled', 'failed')).toBe(false);
    expect(service.canTransition('cancelled', 'validated')).toBe(false);
  });

  it('returns the original instruction for an identical idempotent retry', async () => {
    const existing = {
      id: 'instruction-1',
      payloadHash: '',
    };
    const prisma: any = {
      paymentInstruction: { findUnique: jest.fn() },
    };
    const service = new PaymentOrchestrationService(prisma);
    const input: any = {
      instructionType: 'brand_to_agency',
      sourceOrganizationId: 'brand-1',
      destinationOrganizationId: 'agency-1',
      amount: '100.00',
      currency: 'usd',
      idempotencyScope: 'brand-1',
      idempotencyKey: 'invoice-1',
      requestedById: 'user-1',
    };
    prisma.paymentInstruction.findUnique.mockResolvedValueOnce(null);
    prisma.$transaction = jest.fn().mockImplementation(async (callback) =>
      callback({
        paymentInstruction: {
          create: jest.fn().mockImplementation(({ data }) => {
            existing.payloadHash = data.payloadHash;
            return { ...existing, ...data };
          }),
        },
        paymentInstructionEvent: { create: jest.fn() },
      }),
    );
    const first = await service.createInstruction(input);
    prisma.paymentInstruction.findUnique.mockResolvedValueOnce(
      first.instruction,
    );

    const retry = await service.createInstruction({
      ...input,
      currency: 'USD',
    });

    expect(first.duplicate).toBe(false);
    expect(retry.duplicate).toBe(true);
    expect(retry.instruction.id).toBe('instruction-1');
  });

  it('rejects an idempotency key reused with changed economics', async () => {
    const prisma: any = {
      paymentInstruction: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'instruction-1', payloadHash: 'different' }),
      },
    };
    const service = new PaymentOrchestrationService(prisma);

    await expect(
      service.createInstruction({
        instructionType: 'agency_to_talent_balance',
        sourceOrganizationId: 'agency-1',
        destinationParticipantId: 'talent-1',
        amount: '100',
        currency: 'USD',
        idempotencyScope: 'agency-1',
        idempotencyKey: 'allocation-1',
        requestedById: 'user-1',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects malformed amounts before persistence', async () => {
    const service = new PaymentOrchestrationService({} as any);

    await expect(
      service.createInstruction({
        instructionType: 'talent_withdrawal',
        sourceParticipantId: 'talent-1',
        destinationParticipantId: 'talent-1',
        amount: 'not-money',
        currency: 'USD',
        idempotencyScope: 'talent-1',
        idempotencyKey: 'withdrawal-1',
        requestedById: 'user-1',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

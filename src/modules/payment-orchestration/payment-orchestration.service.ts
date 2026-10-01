import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  PaymentAttemptStatus,
  PaymentInstructionStatus,
  PaymentInstructionType,
  Prisma,
} from '@prisma/client';
import * as crypto from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';

export interface CreatePaymentInstructionInput {
  instructionType: PaymentInstructionType;
  sourceOrganizationId?: string;
  destinationOrganizationId?: string;
  sourceParticipantId?: string;
  destinationParticipantId?: string;
  sourceFinancialAccountId?: string;
  destinationFinancialAccountId?: string;
  commercialDocumentVersionId?: string;
  payableAllocationId?: string;
  amount: number | string | Prisma.Decimal;
  currency: string;
  providerRequired?: boolean;
  purpose?: string;
  idempotencyScope: string;
  idempotencyKey: string;
  requestedById: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class PaymentOrchestrationService {
  private readonly transitions: Record<
    PaymentInstructionStatus,
    PaymentInstructionStatus[]
  > = {
    requested: ['validated', 'failed', 'cancelled', 'review_required'],
    validated: [
      'awaiting_funding',
      'awaiting_provider',
      'settled',
      'failed',
      'cancelled',
      'review_required',
    ],
    awaiting_funding: [
      'funding_pending',
      'funded',
      'failed',
      'cancelled',
      'review_required',
    ],
    funding_pending: ['funded', 'failed', 'cancelled', 'review_required'],
    funded: ['awaiting_provider', 'settled', 'failed', 'review_required'],
    awaiting_provider: ['submitted', 'failed', 'cancelled', 'review_required'],
    submitted: [
      'processing',
      'settled',
      'failed',
      'returned',
      'review_required',
    ],
    processing: ['settled', 'failed', 'returned', 'review_required'],
    settled: ['returned'],
    failed: ['review_required'],
    cancelled: [],
    returned: ['review_required'],
    review_required: ['validated', 'awaiting_provider', 'failed', 'cancelled'],
  };

  private readonly attemptTransitions: Record<
    PaymentAttemptStatus,
    PaymentAttemptStatus[]
  > = {
    requested: ['submitted', 'failed'],
    submitted: ['accepted', 'settled', 'failed', 'unknown'],
    accepted: ['settled', 'failed', 'unknown'],
    settled: [],
    failed: [],
    unknown: ['accepted', 'settled', 'failed'],
  };

  constructor(private readonly prisma: PrismaService) {}

  private canonicalJson(value: unknown): string {
    if (Array.isArray(value)) {
      return `[${value.map((item) => this.canonicalJson(item)).join(',')}]`;
    }
    if (value && typeof value === 'object') {
      return `{${Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(
          ([key, item]) => `${JSON.stringify(key)}:${this.canonicalJson(item)}`,
        )
        .join(',')}}`;
    }
    return JSON.stringify(value);
  }

  private hash(value: unknown): string {
    return crypto
      .createHash('sha256')
      .update(this.canonicalJson(value))
      .digest('hex');
  }

  private assertSamePayload(
    existing: { payloadHash: string },
    payloadHash: string,
  ) {
    if (existing.payloadHash !== payloadHash) {
      throw new ConflictException(
        'Idempotency key was already used for a different payment command',
      );
    }
  }

  canTransition(
    current: PaymentInstructionStatus,
    target: PaymentInstructionStatus,
  ) {
    return this.transitions[current].includes(target);
  }

  async createInstruction(input: CreatePaymentInstructionInput) {
    let amount: Prisma.Decimal;
    try {
      amount = new Prisma.Decimal(input.amount);
    } catch {
      throw new BadRequestException('Payment amount must be a valid decimal');
    }
    const currency = String(input.currency || '')
      .trim()
      .toUpperCase();
    const idempotencyScope = String(input.idempotencyScope || '').trim();
    const idempotencyKey = String(input.idempotencyKey || '').trim();
    if (!amount.isPositive())
      throw new BadRequestException('Payment amount must be greater than zero');
    if (!/^[A-Z]{3}$/.test(currency))
      throw new BadRequestException(
        'Payment currency must be a three-letter code',
      );
    if (!input.sourceOrganizationId && !input.sourceParticipantId) {
      throw new BadRequestException(
        'A source organization or participant is required',
      );
    }
    if (!input.destinationOrganizationId && !input.destinationParticipantId) {
      throw new BadRequestException(
        'A destination organization or participant is required',
      );
    }
    if (!idempotencyScope || !idempotencyKey) {
      throw new BadRequestException('Idempotency scope and key are required');
    }

    const normalized = {
      instructionType: input.instructionType,
      sourceOrganizationId: input.sourceOrganizationId || null,
      destinationOrganizationId: input.destinationOrganizationId || null,
      sourceParticipantId: input.sourceParticipantId || null,
      destinationParticipantId: input.destinationParticipantId || null,
      sourceFinancialAccountId: input.sourceFinancialAccountId || null,
      destinationFinancialAccountId:
        input.destinationFinancialAccountId || null,
      commercialDocumentVersionId: input.commercialDocumentVersionId || null,
      payableAllocationId: input.payableAllocationId || null,
      amount: amount.toFixed(4),
      currency,
      providerRequired: input.providerRequired ?? true,
      purpose: input.purpose || '',
      requestedById: input.requestedById,
      metadata: input.metadata || {},
    };
    const payloadHash = this.hash(normalized);
    const unique = {
      idempotencyScope_idempotencyKey: { idempotencyScope, idempotencyKey },
    };
    const existing = await this.prisma.paymentInstruction.findUnique({
      where: unique,
    });
    if (existing) {
      this.assertSamePayload(existing, payloadHash);
      return { instruction: existing, duplicate: true };
    }

    try {
      const instruction = await this.prisma.$transaction(async (tx) => {
        const created = await tx.paymentInstruction.create({
          data: {
            ...normalized,
            amount,
            metadata: normalized.metadata as Prisma.InputJsonValue,
            idempotencyScope,
            idempotencyKey,
            payloadHash,
          },
        });
        await tx.paymentInstructionEvent.create({
          data: {
            instructionId: created.id,
            sequence: 1,
            toStatus: 'requested',
            actorId: input.requestedById,
            reason: 'Payment instruction created',
          },
        });
        return created;
      });
      return { instruction, duplicate: false };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const raced = await this.prisma.paymentInstruction.findUnique({
          where: unique,
        });
        if (raced) {
          this.assertSamePayload(raced, payloadHash);
          return { instruction: raced, duplicate: true };
        }
      }
      throw error;
    }
  }

  async transitionInstruction(
    instructionId: string,
    target: PaymentInstructionStatus,
    details: {
      actorId?: string;
      reason?: string;
      failureCode?: string;
      metadata?: Record<string, unknown>;
    } = {},
  ) {
    return this.prisma.$transaction(async (tx) => {
      const instruction = await tx.paymentInstruction.findUnique({
        where: { id: instructionId },
      });
      if (!instruction)
        throw new NotFoundException('Payment instruction not found');
      if (instruction.status === target) return instruction;
      if (!this.canTransition(instruction.status, target)) {
        throw new BadRequestException(
          `Invalid payment instruction transition from ${instruction.status} to ${target}`,
        );
      }
      const now = new Date();
      const timestamps: Record<string, Date> = {};
      if (target === 'submitted') timestamps.submittedAt = now;
      if (target === 'settled') timestamps.settledAt = now;
      if (target === 'failed') timestamps.failedAt = now;
      if (target === 'cancelled') timestamps.cancelledAt = now;
      const updated = await tx.paymentInstruction.updateMany({
        where: {
          id: instruction.id,
          status: instruction.status,
          revision: instruction.revision,
        },
        data: {
          status: target,
          revision: { increment: 1 },
          ...timestamps,
          failureCode: target === 'failed' ? details.failureCode : undefined,
          failureReason: target === 'failed' ? details.reason : undefined,
        },
      });
      if (updated.count !== 1) {
        throw new ConflictException(
          'Payment instruction changed concurrently; retry from current state',
        );
      }
      await tx.paymentInstructionEvent.create({
        data: {
          instructionId: instruction.id,
          sequence: instruction.revision + 2,
          fromStatus: instruction.status,
          toStatus: target,
          actorId: details.actorId,
          reason: details.reason,
          metadata: (details.metadata || {}) as Prisma.InputJsonValue,
        },
      });
      return tx.paymentInstruction.findUniqueOrThrow({
        where: { id: instruction.id },
      });
    });
  }

  async beginProviderAttempt(input: {
    instructionId: string;
    provider: string;
    operationType: string;
    idempotencyKey: string;
    requestPayload?: Record<string, unknown>;
  }) {
    const provider = input.provider.trim().toLowerCase();
    const idempotencyKey = input.idempotencyKey.trim();
    if (!provider || !input.operationType.trim() || !idempotencyKey) {
      throw new BadRequestException(
        'Provider, operation type, and idempotency key are required',
      );
    }
    const requestPayload = input.requestPayload || {};
    const requestHash = this.hash({
      instructionId: input.instructionId,
      provider,
      operationType: input.operationType,
      requestPayload,
    });
    const unique = { provider_idempotencyKey: { provider, idempotencyKey } };
    const existing = await this.prisma.paymentAttempt.findUnique({
      where: unique,
    });
    if (existing) {
      if (
        existing.instructionId !== input.instructionId ||
        existing.requestHash !== requestHash
      ) {
        throw new ConflictException(
          'Provider idempotency key was reused for a different request',
        );
      }
      return { attempt: existing, duplicate: true };
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const instruction = await tx.paymentInstruction.findUnique({
          where: { id: input.instructionId },
        });
        if (!instruction)
          throw new NotFoundException('Payment instruction not found');
        if (!instruction.providerRequired) {
          throw new BadRequestException(
            'Internal payment instructions cannot create provider attempts',
          );
        }
        const inboundFunding = input.operationType.trim() === 'inbound_funding';
        const expectedStatus = inboundFunding
          ? 'awaiting_funding'
          : 'awaiting_provider';
        if (instruction.status !== expectedStatus) {
          throw new BadRequestException(
            'Payment instruction is not ready for a provider attempt',
          );
        }
        const latest = await tx.paymentAttempt.aggregate({
          where: { instructionId: instruction.id },
          _max: { attemptNumber: true },
        });
        const attempt = await tx.paymentAttempt.create({
          data: {
            instructionId: instruction.id,
            attemptNumber: (latest._max.attemptNumber || 0) + 1,
            provider,
            operationType: input.operationType.trim(),
            idempotencyKey,
            requestHash,
            requestPayload: requestPayload as Prisma.InputJsonValue,
          },
        });
        return { attempt, duplicate: false };
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const raced = await this.prisma.paymentAttempt.findUnique({
          where: unique,
        });
        if (raced) {
          if (
            raced.instructionId !== input.instructionId ||
            raced.requestHash !== requestHash
          ) {
            throw new ConflictException(
              'Provider idempotency key was reused for a different request',
            );
          }
          return { attempt: raced, duplicate: true };
        }
        throw new ConflictException(
          'Another provider attempt is already active for this instruction',
        );
      }
      throw error;
    }
  }

  async transitionAttempt(
    attemptId: string,
    target: PaymentAttemptStatus,
    details: {
      externalReference?: string;
      responsePayload?: Record<string, unknown>;
      errorCode?: string;
      errorMessage?: string;
    } = {},
  ) {
    return this.prisma.$transaction(async (tx) => {
      const attempt = await tx.paymentAttempt.findUnique({
        where: { id: attemptId },
      });
      if (!attempt) throw new NotFoundException('Payment attempt not found');
      if (attempt.status === target) return attempt;
      if (!this.attemptTransitions[attempt.status].includes(target)) {
        throw new BadRequestException(
          `Invalid payment attempt transition from ${attempt.status} to ${target}`,
        );
      }
      const updated = await tx.paymentAttempt.updateMany({
        where: { id: attempt.id, status: attempt.status },
        data: {
          status: target,
          externalReference: details.externalReference,
          responsePayload: (details.responsePayload ||
            {}) as Prisma.InputJsonValue,
          errorCode: details.errorCode,
          errorMessage: details.errorMessage,
          submittedAt: target === 'submitted' ? new Date() : undefined,
          completedAt: ['settled', 'failed'].includes(target)
            ? new Date()
            : undefined,
        },
      });
      if (updated.count !== 1) {
        throw new ConflictException(
          'Payment attempt changed concurrently; reload its current state',
        );
      }
      return tx.paymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
    });
  }

  getInstruction(instructionId: string) {
    return this.prisma.paymentInstruction.findUnique({
      where: { id: instructionId },
      include: {
        events: { orderBy: { sequence: 'asc' } },
        attempts: { orderBy: { attemptNumber: 'asc' } },
      },
    });
  }
}

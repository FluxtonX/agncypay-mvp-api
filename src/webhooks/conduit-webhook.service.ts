import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { PaymentInstructionStatus, Prisma } from '@prisma/client';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { PAYMENT_PROVIDER } from '../core/interfaces/payment-provider.interface';
import type { PaymentProvider } from '../core/interfaces/payment-provider.interface';
import { PaymentOrchestrationService } from '../modules/payment-orchestration/payment-orchestration.service';
import { PaymentService } from '../modules/payments/payment.service';
import { TalentBalancesService } from '../modules/talent-balances/talent-balances.service';

@Injectable()
export class ConduitWebhookService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orchestration: PaymentOrchestrationService,
    private readonly payments: PaymentService,
    private readonly talentBalances: TalentBalancesService,
    @Inject(PAYMENT_PROVIDER) private readonly paymentProvider: PaymentProvider,
  ) {}

  private canonicalJson(value: unknown): string {
    if (Array.isArray(value))
      return `[${value.map((item) => this.canonicalJson(item)).join(',')}]`;
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

  private hash(value: unknown) {
    return crypto
      .createHash('sha256')
      .update(this.canonicalJson(value))
      .digest('hex');
  }

  private async receive(
    eventType: string,
    payload: any,
    suppliedEventId?: string,
  ) {
    const data = payload?.data || {};
    const resourceId = data.id || data.transactionId || data.transaction_id;
    const version =
      data.updatedAt ||
      data.updated_at ||
      data.status ||
      payload.version ||
      '1';
    const externalEventId =
      suppliedEventId ||
      payload.id ||
      `${eventType}:${resourceId || 'unknown'}:${version}`;
    const payloadHash = this.hash(payload);
    const existing = await this.prisma.providerWebhookEvent.findUnique({
      where: {
        provider_externalEventId: {
          provider: this.paymentProvider.name,
          externalEventId,
        },
      },
    });
    if (existing) {
      if (existing.payloadHash !== payloadHash) {
        throw new ConflictException(
          'Provider webhook event ID was reused with a different payload',
        );
      }
      return { event: existing, duplicate: true };
    }
    const occurredAtValue =
      data.updatedAt || data.updated_at || data.createdAt || data.created_at;
    return {
      event: await this.prisma.providerWebhookEvent.create({
        data: {
          provider: this.paymentProvider.name,
          externalEventId,
          eventType,
          payloadHash,
          payload,
          occurredAt: occurredAtValue ? new Date(occurredAtValue) : undefined,
        },
      }),
      duplicate: false,
    };
  }

  async processWebhook(input: {
    signature?: string;
    timestamp?: string;
    payload: any;
    rawBody?: Buffer | string;
    eventId?: string;
  }) {
    if (
      !input.signature ||
      !input.rawBody ||
      !this.paymentProvider.verifyWebhookSignature(
        input.signature,
        input.rawBody,
        input.timestamp,
      )
    ) {
      throw new BadRequestException('Invalid webhook signature');
    }
    const eventType = String(input.payload?.event || input.payload?.type || '');
    if (!eventType)
      throw new BadRequestException('Provider webhook event type is required');
    const received = await this.receive(
      eventType,
      input.payload,
      input.eventId,
    );
    if (
      received.duplicate &&
      ['processed', 'ignored'].includes(received.event.status)
    ) {
      return {
        received: true,
        duplicate: true,
        eventId: received.event.id,
        status: received.event.status,
      };
    }
    const claimed = await this.prisma.providerWebhookEvent.updateMany({
      where: { id: received.event.id, status: { in: ['received', 'failed'] } },
      data: { status: 'processing', attempts: { increment: 1 }, error: null },
    });
    if (claimed.count !== 1) {
      return {
        received: true,
        duplicate: true,
        eventId: received.event.id,
        status: 'processing',
      };
    }
    try {
      const processed = await this.synchronize(
        eventType,
        input.payload?.data || {},
      );
      await this.prisma.providerWebhookEvent.update({
        where: { id: received.event.id },
        data: {
          status: processed ? 'processed' : 'ignored',
          processedAt: new Date(),
        },
      });
      return {
        received: true,
        duplicate: false,
        eventId: received.event.id,
        status: processed ? 'processed' : 'ignored',
      };
    } catch (error: any) {
      await this.prisma.providerWebhookEvent.update({
        where: { id: received.event.id },
        data: {
          status: 'failed',
          error: String(error?.message || error).slice(0, 2000),
        },
      });
      throw error;
    }
  }

  private async findAttempt(data: any) {
    const externalReference =
      data.id || data.transactionId || data.transaction_id;
    if (externalReference) {
      const byExternal = await this.prisma.paymentAttempt.findFirst({
        where: {
          provider: this.paymentProvider.name,
          externalReference: String(externalReference),
        },
        include: { instruction: true },
      });
      if (byExternal) return byExternal;
    }
    const instructionId = data.reference || data.metadata?.paymentInstructionId;
    if (!instructionId) return null;
    return this.prisma.paymentAttempt.findFirst({
      where: {
        provider: this.paymentProvider.name,
        instructionId: String(instructionId),
        status: { in: ['submitted', 'accepted', 'unknown'] },
      },
      include: { instruction: true },
      orderBy: { attemptNumber: 'desc' },
    });
  }

  private async synchronize(eventType: string, data: any) {
    if (eventType.startsWith('customer.')) {
      return this.synchronizeCustomer(eventType, data);
    }
    if (!eventType.startsWith('transaction.')) return false;
    const attempt = await this.findAttempt(data);
    if (!attempt) {
      await this.recordIssue({
        dedupeKey: `webhook-missing-attempt:${this.paymentProvider.name}:${data.id || eventType}`,
        reconciliationType: 'provider_webhook',
        entityType: 'payment_attempt',
        providerState: eventType,
        discrepancyType: 'missing_internal',
        provider: this.paymentProvider.name,
        externalReference: data.id,
        notes:
          'Verified provider transaction event could not be mapped to an internal attempt',
      });
      return false;
    }
    const terminalSuccess =
      eventType === 'transaction.completed' ||
      eventType.endsWith('.payment_processed') ||
      eventType.endsWith('.settlement_processed') ||
      eventType.endsWith('.withdrawal_processed');
    const terminalFailure =
      eventType === 'transaction.cancelled' ||
      eventType === 'transaction.failed' ||
      eventType === 'transaction.compliance_rejected';
    if (terminalSuccess) {
      await this.settleAttempt(attempt, data);
    } else if (terminalFailure) {
      await this.failAttempt(
        attempt,
        data.failureReason || data.failure_reason || eventType,
      );
    } else {
      await this.markProcessing(attempt);
    }
    return true;
  }

  private async markProcessing(attempt: any) {
    if (attempt.status === 'submitted') {
      await this.orchestration.transitionAttempt(attempt.id, 'accepted', {
        externalReference: attempt.externalReference,
      });
    }
    if (attempt.instruction.status === 'submitted') {
      await this.orchestration.transitionInstruction(
        attempt.instructionId,
        'processing',
        {
          reason: 'Payment provider reported transaction processing',
        },
      );
    }
  }

  private async settleAttempt(attempt: any, data: any) {
    const externalReference = String(
      data.id ||
        data.transactionId ||
        data.transaction_id ||
        attempt.externalReference ||
        '',
    );
    if (!externalReference)
      throw new BadRequestException(
        'Settled provider transaction has no reference',
      );
    if (attempt.status !== 'settled') {
      await this.orchestration.transitionAttempt(attempt.id, 'settled', {
        externalReference,
        responsePayload: data,
      });
    }
    if (attempt.operationType === 'inbound_funding') {
      const amount = data.source?.amount ?? data.amount;
      const currency = data.source?.asset ?? data.currency;
      if (amount == null || !currency) {
        throw new BadRequestException(
          'Inbound funding webhook is missing amount or currency',
        );
      }
      await this.payments.settleInboundFunding(attempt.instructionId, {
        providerReference: externalReference,
        amount,
        currency,
        rawPayload: data,
      });
      return;
    }
    if (attempt.operationType === 'talent_withdrawal') {
      await this.talentBalances.settleWithdrawal(
        attempt.instructionId,
        externalReference,
      );
    } else if (attempt.operationType === 'fx_conversion') {
      const conversion = await this.prisma.fxConversion.findUnique({
        where: { paymentInstructionId: attempt.instructionId },
        include: { quote: true },
      });
      if (!conversion)
        throw new BadRequestException('FX conversion record not found');
      await this.talentBalances.settleConversion(
        attempt.instructionId,
        conversion.quote.destinationAmount,
        externalReference,
      );
      await this.prisma.$transaction([
        this.prisma.fxConversion.update({
          where: { id: conversion.id },
          data: {
            status: 'settled',
            providerConversionId: externalReference,
            providerResponse: data as Prisma.InputJsonValue,
            settledAt: new Date(),
          },
        }),
        this.prisma.fxQuote.update({
          where: { id: conversion.quoteId },
          data: { status: 'consumed' },
        }),
      ]);
    }
    const instruction = await this.prisma.paymentInstruction.findUnique({
      where: { id: attempt.instructionId },
    });
    if (instruction && instruction.status !== 'settled') {
      await this.orchestration.transitionInstruction(
        instruction.id,
        'settled',
        {
          reason: 'Payment provider reported transaction completed',
          metadata: { providerReference: externalReference },
        },
      );
    }
  }

  private async failAttempt(attempt: any, reason: string) {
    if (!['failed', 'settled'].includes(attempt.status)) {
      await this.orchestration.transitionAttempt(attempt.id, 'failed', {
        errorCode: 'PROVIDER_TERMINAL_FAILURE',
        errorMessage: reason,
      });
    }
    if (attempt.operationType === 'talent_withdrawal') {
      await this.talentBalances.releaseWithdrawal(
        attempt.instructionId,
        reason,
      );
    } else if (attempt.operationType === 'fx_conversion') {
      await this.talentBalances.releaseConversion(
        attempt.instructionId,
        reason,
      );
      await this.prisma.fxConversion.updateMany({
        where: {
          paymentInstructionId: attempt.instructionId,
          status: { not: 'settled' },
        },
        data: {
          status: 'failed',
          failureCode: 'PROVIDER_TERMINAL_FAILURE',
          failureReason: reason,
        },
      });
    }
    const instruction = await this.prisma.paymentInstruction.findUnique({
      where: { id: attempt.instructionId },
    });
    if (
      instruction &&
      !['failed', 'settled', 'cancelled'].includes(instruction.status)
    ) {
      await this.orchestration.transitionInstruction(
        instruction.id,
        'failed' as PaymentInstructionStatus,
        { failureCode: 'PROVIDER_TERMINAL_FAILURE', reason },
      );
    }
  }

  private async synchronizeCustomer(eventType: string, data: any) {
    const externalId = data.id || data.customerId || data.customer_id;
    if (!externalId) return false;
    const mapping = await this.prisma.providerPartyMap.findFirst({
      where: {
        provider: this.paymentProvider.name,
        externalId: String(externalId),
      },
    });
    if (!mapping) return false;
    const status =
      eventType === 'customer.active'
        ? 'active'
        : eventType === 'customer.compliance_rejected'
          ? 'restricted'
          : 'pending';
    await this.prisma.providerPartyMap.update({
      where: { id: mapping.id },
      data: { status },
    });
    return true;
  }

  private recordIssue(data: {
    dedupeKey: string;
    reconciliationType: string;
    entityType: string;
    entityId?: string;
    providerState?: string;
    internalState?: string;
    discrepancyType: string;
    provider?: string;
    externalReference?: string;
    notes?: string;
  }) {
    return this.prisma.reconciliationRecord.upsert({
      where: { dedupeKey: data.dedupeKey },
      update: {
        providerState: data.providerState,
        internalState: data.internalState,
        notes: data.notes,
        lastCheckedAt: new Date(),
        resolution: 'unresolved',
        resolvedAt: null,
      },
      create: { ...data, lastCheckedAt: new Date() },
    });
  }
}

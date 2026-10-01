import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as crypto from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { PAYMENT_PROVIDER } from '../../core/interfaces/payment-provider.interface';
import type { PaymentProvider } from '../../core/interfaces/payment-provider.interface';
import { PaymentOrchestrationService } from '../payment-orchestration/payment-orchestration.service';
import { TalentBalancesService } from '../talent-balances/talent-balances.service';

@Injectable()
export class FxService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orchestration: PaymentOrchestrationService,
    private readonly balances: TalentBalancesService,
    @Inject(PAYMENT_PROVIDER) private readonly paymentProvider: PaymentProvider,
  ) {}

  private hash(value: unknown) {
    const canonical = (item: any): string => {
      if (Array.isArray(item)) return `[${item.map(canonical).join(',')}]`;
      if (item && typeof item === 'object') {
        return `{${Object.keys(item)
          .sort()
          .map((key) => `${JSON.stringify(key)}:${canonical(item[key])}`)
          .join(',')}}`;
      }
      return JSON.stringify(item);
    };
    return crypto.createHash('sha256').update(canonical(value)).digest('hex');
  }

  private async participant(userId: string) {
    const link = await this.prisma.participantUser.findUnique({
      where: { userId },
    });
    if (!link)
      throw new NotFoundException('Talent participant identity not found');
    return link.participantId;
  }

  async createQuote(
    userId: string,
    input: {
      sourceCurrency: string;
      destinationCurrency: string;
      sourceAmount: number | string;
      idempotencyKey: string;
    },
  ) {
    const participantId = await this.participant(userId);
    const sourceCurrency = input.sourceCurrency.toUpperCase();
    const destinationCurrency = input.destinationCurrency.toUpperCase();
    let sourceAmount: Prisma.Decimal;
    try {
      sourceAmount = new Prisma.Decimal(input.sourceAmount);
    } catch {
      throw new BadRequestException('FX amount must be a valid decimal');
    }
    if (!sourceAmount.isPositive())
      throw new BadRequestException('FX amount must be positive');
    if (
      !/^[A-Z]{3}$/.test(sourceCurrency) ||
      !/^[A-Z]{3}$/.test(destinationCurrency)
    ) {
      throw new BadRequestException('FX currencies must be three-letter codes');
    }
    if (sourceCurrency === destinationCurrency)
      throw new BadRequestException('FX currencies must differ');
    if (!input.idempotencyKey?.trim())
      throw new BadRequestException('Idempotency-Key is required');
    const available = await this.prisma.talentBalanceLot.aggregate({
      where: {
        participantId,
        currency: sourceCurrency,
        status: { not: 'reversed' },
      },
      _sum: { availableAmount: true },
    });
    if (
      (available._sum.availableAmount || new Prisma.Decimal(0)).lessThan(
        sourceAmount,
      )
    ) {
      throw new BadRequestException(
        'Insufficient available balance for FX quote',
      );
    }
    const normalized = {
      participantId,
      sourceCurrency,
      destinationCurrency,
      sourceAmount: sourceAmount.toFixed(4),
    };
    const payloadHash = this.hash(normalized);
    const idempotencyScope = `${participantId}:fx-quote`;
    const unique = {
      idempotencyScope_idempotencyKey: {
        idempotencyScope,
        idempotencyKey: input.idempotencyKey.trim(),
      },
    };
    const existing = await this.prisma.fxQuote.findUnique({ where: unique });
    if (existing) {
      if (existing.payloadHash !== payloadHash)
        throw new ConflictException('FX quote idempotency conflict');
      return { quote: existing, duplicate: true };
    }
    const providerQuote = await this.paymentProvider.createFxQuote({
      sourceCurrency,
      destinationCurrency,
      sourceAmount: sourceAmount.toNumber(),
      idempotencyKey: input.idempotencyKey.trim(),
      metadata: { participantId },
    });
    if (
      providerQuote.sourceCurrency !== sourceCurrency ||
      providerQuote.destinationCurrency !== destinationCurrency ||
      !new Prisma.Decimal(providerQuote.sourceAmount).equals(sourceAmount)
    ) {
      throw new BadGatewayException(
        'Payment provider returned mismatched FX quote economics',
      );
    }
    const quote = await this.prisma.fxQuote.create({
      data: {
        participantId,
        requestedById: userId,
        provider: this.paymentProvider.name,
        providerQuoteId: providerQuote.id,
        sourceCurrency,
        destinationCurrency,
        sourceAmount,
        destinationAmount: providerQuote.destinationAmount,
        exchangeRate: providerQuote.exchangeRate,
        feeAmount: providerQuote.feeAmount,
        feeCurrency: providerQuote.feeCurrency,
        expiresAt: new Date(providerQuote.expiresAt),
        idempotencyScope,
        idempotencyKey: input.idempotencyKey.trim(),
        payloadHash,
        providerResponse: (providerQuote.raw || {}) as Prisma.InputJsonValue,
      },
    });
    return { quote, duplicate: false };
  }

  async executeQuote(userId: string, quoteId: string, idempotencyKey: string) {
    const participantId = await this.participant(userId);
    const quote = await this.prisma.fxQuote.findFirst({
      where: { id: quoteId, participantId },
    });
    if (!quote) throw new NotFoundException('FX quote not found');
    if (!idempotencyKey?.trim())
      throw new BadRequestException('Idempotency-Key is required');
    const existing = await this.prisma.fxConversion.findUnique({
      where: { quoteId: quote.id },
    });
    if (existing) {
      if (existing.idempotencyKey !== idempotencyKey.trim()) {
        throw new ConflictException(
          'FX quote is already bound to another conversion command',
        );
      }
      return { conversion: existing, duplicate: true };
    }
    if (quote.expiresAt <= new Date()) {
      await this.prisma.fxQuote.updateMany({
        where: { id: quote.id, status: 'active' },
        data: { status: 'expired' },
      });
      throw new BadRequestException('FX quote has expired');
    }
    if (quote.status !== 'active')
      throw new ConflictException('FX quote is not active');
    const platformAccount = await this.prisma.financialAccount.findFirst({
      where: {
        organization: { type: 'platform', status: 'active' },
        type: 'virtual_account',
        status: 'ready',
        providerAccounts: {
          some: { provider: this.paymentProvider.name, status: 'active' },
        },
      },
      include: { providerAccounts: true },
    });
    const providerAccount = platformAccount?.providerAccounts.find(
      (item) =>
        item.provider === this.paymentProvider.name && item.status === 'active',
    );
    if (!platformAccount || !providerAccount) {
      throw new BadRequestException(
        'Platform FX custody account is not configured',
      );
    }
    const created = await this.orchestration.createInstruction({
      instructionType: 'balance_conversion',
      sourceParticipantId: participantId,
      destinationParticipantId: participantId,
      amount: quote.sourceAmount,
      currency: quote.sourceCurrency,
      providerRequired: true,
      purpose: 'talent_balance_conversion',
      idempotencyScope: `${participantId}:fx-conversion`,
      idempotencyKey: idempotencyKey.trim(),
      requestedById: userId,
      metadata: {
        provider: this.paymentProvider.name,
        fxQuoteId: quote.id,
        destinationCurrency: quote.destinationCurrency,
        destinationAmount: quote.destinationAmount.toString(),
      },
    });
    let instruction = created.instruction;
    await this.balances.reserveConversion(instruction.id);
    instruction = await this.orchestration.transitionInstruction(
      instruction.id,
      'validated',
      {
        actorId: userId,
        reason: 'Source balance reserved against locked FX quote',
      },
    );
    instruction = await this.orchestration.transitionInstruction(
      instruction.id,
      'awaiting_provider',
      { actorId: userId },
    );
    const conversion = await this.prisma.fxConversion.create({
      data: {
        quoteId: quote.id,
        paymentInstructionId: instruction.id,
        provider: this.paymentProvider.name,
        idempotencyKey: idempotencyKey.trim(),
      },
    });
    const attempt = await this.orchestration.beginProviderAttempt({
      instructionId: instruction.id,
      provider: this.paymentProvider.name,
      operationType: 'fx_conversion',
      idempotencyKey: `${instruction.id}:fx`,
      requestPayload: {
        providerQuoteId: quote.providerQuoteId,
        providerAccountId: providerAccount.externalId,
      },
    });
    await this.orchestration.transitionAttempt(attempt.attempt.id, 'submitted');
    await this.orchestration.transitionInstruction(
      instruction.id,
      'submitted',
      { actorId: userId },
    );
    await this.prisma.fxConversion.update({
      where: { id: conversion.id },
      data: { status: 'submitted' },
    });
    try {
      const result = await this.paymentProvider.executeFxConversion({
        quoteId: quote.providerQuoteId,
        sourceAccountId: providerAccount.externalId,
        destinationAccountId: providerAccount.externalId,
        idempotencyKey: `${instruction.id}:fx`,
        reference: instruction.id,
        purpose: 'Other',
        metadata: { fxConversionId: conversion.id, participantId },
      });
      if (result.status === 'completed') {
        await this.orchestration.transitionAttempt(
          attempt.attempt.id,
          'settled',
          {
            externalReference: result.id,
            responsePayload: result.raw,
          },
        );
        await this.balances.settleConversion(
          instruction.id,
          quote.destinationAmount,
          result.id,
        );
        await this.orchestration.transitionInstruction(
          instruction.id,
          'settled',
          {
            actorId: userId,
            reason: 'FX conversion settled and destination balance credited',
          },
        );
        const settled = await this.prisma.$transaction([
          this.prisma.fxConversion.update({
            where: { id: conversion.id },
            data: {
              status: 'settled',
              providerConversionId: result.id,
              providerResponse: (result.raw || {}) as Prisma.InputJsonValue,
              settledAt: new Date(),
            },
          }),
          this.prisma.fxQuote.update({
            where: { id: quote.id },
            data: { status: 'consumed' },
          }),
        ]);
        return { conversion: settled[0], duplicate: false };
      }
      if (!['pending', 'processing'].includes(result.status)) {
        throw new Error(
          result.failureCode || `Provider returned ${result.status}`,
        );
      }
      await this.orchestration.transitionAttempt(
        attempt.attempt.id,
        'accepted',
        {
          externalReference: result.id,
          responsePayload: result.raw,
        },
      );
      await this.orchestration.transitionInstruction(
        instruction.id,
        'processing',
        { actorId: userId },
      );
      const processing = await this.prisma.fxConversion.update({
        where: { id: conversion.id },
        data: {
          status: 'processing',
          providerConversionId: result.id,
          providerResponse: (result.raw || {}) as Prisma.InputJsonValue,
        },
      });
      return { conversion: processing, duplicate: false };
    } catch (error: any) {
      await this.balances.releaseConversion(instruction.id, error.message);
      await this.orchestration.transitionAttempt(attempt.attempt.id, 'failed', {
        errorCode: 'FX_PROVIDER_FAILED',
        errorMessage: error.message,
      });
      await this.orchestration.transitionInstruction(instruction.id, 'failed', {
        actorId: userId,
        failureCode: 'FX_CONVERSION_FAILED',
        reason: error.message,
      });
      await this.prisma.fxConversion.update({
        where: { id: conversion.id },
        data: {
          status: 'failed',
          failureCode: 'FX_PROVIDER_FAILED',
          failureReason: error.message,
        },
      });
      throw new BadGatewayException(`FX conversion failed: ${error.message}`);
    }
  }
}

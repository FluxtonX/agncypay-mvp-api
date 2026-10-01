import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaymentOrchestrationService } from '../payment-orchestration/payment-orchestration.service';
import { LedgerService } from '../ledger/ledger.service';

@Injectable()
export class TalentBalancesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orchestration: PaymentOrchestrationService,
    private readonly ledger: LedgerService,
  ) {}

  async creditFundedInstruction(instructionId: string) {
    const idempotencyKey = `talent-balance-credit:${instructionId}`;
    const existing = await this.prisma.ledgerTransaction.findUnique({
      where: { idempotencyKey },
      include: { postings: true },
    });
    if (!existing) {
      await this.prisma.$transaction(async (tx) => {
        const instruction = await tx.paymentInstruction.findUnique({
          where: { id: instructionId },
          include: { talentBalanceLot: true },
        });
        if (!instruction)
          throw new NotFoundException('Payment instruction not found');
        if (
          instruction.instructionType !== 'agency_to_talent_balance' ||
          instruction.status !== 'funded' ||
          !instruction.destinationParticipantId
        ) {
          throw new BadRequestException(
            'Instruction is not a funded Talent balance allocation',
          );
        }
        if (instruction.talentBalanceLot) return;
        const metadata = (instruction.metadata || {}) as Record<
          string,
          unknown
        >;
        const provider = String(metadata.provider || 'provider').toUpperCase();
        const cashAccount = await tx.ledgerAccount.upsert({
          where: {
            accountCode: `PROVIDER_CASH:${provider}:${instruction.currency}`,
          },
          update: { status: 'active' },
          create: {
            accountCode: `PROVIDER_CASH:${provider}:${instruction.currency}`,
            accountType: 'asset',
            name: `${provider} safeguarded cash`,
            currency: instruction.currency,
            ownerType: 'system',
            purpose: 'provider_cash',
          },
        });
        const talentAccount = await tx.ledgerAccount.upsert({
          where: {
            accountCode: `TALENT_AP:${instruction.destinationParticipantId}:${instruction.currency}`,
          },
          update: { status: 'active' },
          create: {
            accountCode: `TALENT_AP:${instruction.destinationParticipantId}:${instruction.currency}`,
            accountType: 'liability',
            name: 'Talent AP custodial balance',
            currency: instruction.currency,
            ownerId: instruction.destinationParticipantId,
            ownerType: 'talent',
            participantId: instruction.destinationParticipantId,
            purpose: 'talent_ap_balance',
          },
        });
        await this.ledger.postCanonicalTransaction(
          {
            transactionType: 'talent_balance_funding',
            currency: instruction.currency,
            idempotencyKey,
            referenceType: 'PAYMENT_INSTRUCTION',
            referenceId: instruction.id,
            paymentInstructionId: instruction.id,
            description: 'Agency funds credited to Talent AP balance',
            postings: [
              {
                accountId: cashAccount.id,
                side: 'debit',
                amount: instruction.amount,
                currency: instruction.currency,
              },
              {
                accountId: talentAccount.id,
                side: 'credit',
                amount: instruction.amount,
                currency: instruction.currency,
              },
            ],
          },
          tx,
        );
        await tx.talentBalanceLot.create({
          data: {
            participantId: instruction.destinationParticipantId,
            paymentInstructionId: instruction.id,
            currency: instruction.currency,
            originalAmount: instruction.amount,
            availableAmount: instruction.amount,
            status: 'available',
            availableAt: new Date(),
            events: {
              create: {
                eventType: 'credited',
                amount: instruction.amount,
                availableAfter: instruction.amount,
                heldAfter: 0,
                withdrawnAfter: 0,
                referenceType: 'PAYMENT_INSTRUCTION',
                referenceId: instruction.id,
                idempotencyKey,
                reason: 'Provider funding settled',
              },
            },
          },
        });
      });
    }
    const instruction = await this.orchestration.getInstruction(instructionId);
    if (!instruction)
      throw new NotFoundException('Payment instruction not found');
    if (instruction.status === 'funded') {
      await this.orchestration.transitionInstruction(
        instruction.id,
        'settled',
        {
          reason: 'Talent AP balance credited in the canonical ledger',
        },
      );
    } else if (instruction.status !== 'settled') {
      throw new ConflictException(
        'Ledger credit exists but payment instruction is in an unexpected state',
      );
    }
    return this.prisma.talentBalanceLot.findUnique({
      where: { paymentInstructionId: instructionId },
      include: { events: { orderBy: { createdAt: 'asc' } } },
    });
  }

  private async participantForUser(userId: string) {
    const link = await this.prisma.participantUser.findUnique({
      where: { userId },
    });
    if (!link)
      throw new NotFoundException('Talent participant identity not found');
    return link.participantId;
  }

  async getBalance(userId: string) {
    const participantId = await this.participantForUser(userId);
    const lots = await this.prisma.talentBalanceLot.groupBy({
      by: ['currency'],
      where: { participantId, status: { not: 'reversed' } },
      _sum: {
        originalAmount: true,
        availableAmount: true,
        heldAmount: true,
        withdrawnAmount: true,
        convertedAmount: true,
      },
    });
    return {
      participantId,
      balances: lots.map((lot) => ({
        currency: lot.currency,
        lifetimeFunded: lot._sum.originalAmount || new Prisma.Decimal(0),
        available: lot._sum.availableAmount || new Prisma.Decimal(0),
        held: lot._sum.heldAmount || new Prisma.Decimal(0),
        withdrawn: lot._sum.withdrawnAmount || new Prisma.Decimal(0),
        converted: lot._sum.convertedAmount || new Prisma.Decimal(0),
      })),
    };
  }

  async getActivity(userId: string, limit = 50) {
    const participantId = await this.participantForUser(userId);
    return this.prisma.talentBalanceEvent.findMany({
      where: { lot: { participantId } },
      include: {
        lot: {
          select: {
            currency: true,
            paymentInstructionId: true,
            availableAmount: true,
            heldAmount: true,
            withdrawnAmount: true,
            convertedAmount: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 100),
    });
  }

  async holdLot(
    lotId: string,
    amountValue: number | string,
    idempotencyKey: string,
    reason: string,
  ) {
    const amount = new Prisma.Decimal(amountValue);
    if (!amount.isPositive())
      throw new BadRequestException('Hold amount must be positive');
    const existing = await this.prisma.talentBalanceEvent.findUnique({
      where: { idempotencyKey },
    });
    if (existing) return existing;
    return this.prisma.$transaction(async (tx) => {
      const lot = await tx.talentBalanceLot.findUnique({
        where: { id: lotId },
      });
      if (!lot || lot.status === 'reversed')
        throw new NotFoundException('Available balance lot not found');
      if (lot.availableAmount.lessThan(amount))
        throw new BadRequestException('Insufficient available lot balance');
      const availableAfter = lot.availableAmount.sub(amount);
      const heldAfter = lot.heldAmount.add(amount);
      const updated = await tx.talentBalanceLot.updateMany({
        where: {
          id: lot.id,
          availableAmount: lot.availableAmount,
          heldAmount: lot.heldAmount,
        },
        data: {
          availableAmount: availableAfter,
          heldAmount: heldAfter,
          status: 'held',
        },
      });
      if (updated.count !== 1)
        throw new ConflictException('Balance lot changed concurrently');
      return tx.talentBalanceEvent.create({
        data: {
          lotId: lot.id,
          eventType: 'held',
          amount,
          availableAfter,
          heldAfter,
          withdrawnAfter: lot.withdrawnAmount,
          referenceType: 'BALANCE_HOLD',
          referenceId: lot.id,
          idempotencyKey,
          reason,
        },
      });
    });
  }

  async releaseHold(
    lotId: string,
    amountValue: number | string,
    idempotencyKey: string,
    reason: string,
  ) {
    const amount = new Prisma.Decimal(amountValue);
    if (!amount.isPositive())
      throw new BadRequestException('Release amount must be positive');
    const existing = await this.prisma.talentBalanceEvent.findUnique({
      where: { idempotencyKey },
    });
    if (existing) return existing;
    return this.prisma.$transaction(async (tx) => {
      const lot = await tx.talentBalanceLot.findUnique({
        where: { id: lotId },
      });
      if (!lot || lot.heldAmount.lessThan(amount))
        throw new BadRequestException('Insufficient held lot balance');
      const availableAfter = lot.availableAmount.add(amount);
      const heldAfter = lot.heldAmount.sub(amount);
      const status = heldAfter.isZero() ? 'available' : 'held';
      const updated = await tx.talentBalanceLot.updateMany({
        where: {
          id: lot.id,
          availableAmount: lot.availableAmount,
          heldAmount: lot.heldAmount,
        },
        data: {
          availableAmount: availableAfter,
          heldAmount: heldAfter,
          status,
        },
      });
      if (updated.count !== 1)
        throw new ConflictException('Balance lot changed concurrently');
      return tx.talentBalanceEvent.create({
        data: {
          lotId: lot.id,
          eventType: 'released',
          amount,
          availableAfter,
          heldAfter,
          withdrawnAfter: lot.withdrawnAmount,
          referenceType: 'BALANCE_HOLD',
          referenceId: lot.id,
          idempotencyKey,
          reason,
        },
      });
    });
  }

  async reserveWithdrawal(instructionId: string) {
    return this.reserveBalance(instructionId, 'withdrawal');
  }

  async reserveConversion(instructionId: string) {
    return this.reserveBalance(instructionId, 'fx_conversion');
  }

  private async reserveBalance(
    instructionId: string,
    reservationType: 'withdrawal' | 'fx_conversion',
  ) {
    return this.prisma.$transaction(
      async (tx) => {
        const existing = await tx.talentBalanceReservation.findMany({
          where: { paymentInstructionId: instructionId },
          orderBy: { createdAt: 'asc' },
        });
        if (existing.length) return existing;
        const instruction = await tx.paymentInstruction.findUnique({
          where: { id: instructionId },
        });
        const expectedType =
          reservationType === 'withdrawal'
            ? 'talent_withdrawal'
            : 'balance_conversion';
        if (
          !instruction ||
          instruction.instructionType !== expectedType ||
          !instruction.sourceParticipantId
        ) {
          throw new BadRequestException(
            'Invalid Talent balance reservation instruction',
          );
        }
        const lots = await tx.talentBalanceLot.findMany({
          where: {
            participantId: instruction.sourceParticipantId,
            currency: instruction.currency,
            availableAmount: { gt: 0 },
            status: { not: 'reversed' },
          },
          orderBy: [{ availableAt: 'asc' }, { createdAt: 'asc' }],
        });
        let remaining = instruction.amount;
        const reservations = [];
        for (const lot of lots) {
          if (remaining.isZero()) break;
          const reserved = Prisma.Decimal.min(lot.availableAmount, remaining);
          const availableAfter = lot.availableAmount.sub(reserved);
          const heldAfter = lot.heldAmount.add(reserved);
          const changed = await tx.talentBalanceLot.updateMany({
            where: {
              id: lot.id,
              availableAmount: lot.availableAmount,
              heldAmount: lot.heldAmount,
            },
            data: {
              availableAmount: availableAfter,
              heldAmount: heldAfter,
              status: 'held',
            },
          });
          if (changed.count !== 1)
            throw new ConflictException('Talent balance changed concurrently');
          const reservation = await tx.talentBalanceReservation.create({
            data: {
              paymentInstructionId: instruction.id,
              lotId: lot.id,
              amount: reserved,
              reservationType,
            },
          });
          await tx.talentBalanceEvent.create({
            data: {
              lotId: lot.id,
              eventType:
                reservationType === 'withdrawal'
                  ? 'withdrawal_reserved'
                  : 'conversion_reserved',
              amount: reserved,
              availableAfter,
              heldAfter,
              withdrawnAfter: lot.withdrawnAmount,
              referenceType: 'PAYMENT_INSTRUCTION',
              referenceId: instruction.id,
              idempotencyKey: `${instruction.id}:reserve:${lot.id}`,
            },
          });
          reservations.push(reservation);
          remaining = remaining.sub(reserved);
        }
        if (!remaining.isZero())
          throw new BadRequestException(
            'Insufficient available Talent balance',
          );
        return reservations;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async settleWithdrawal(instructionId: string, providerReference: string) {
    const idempotencyKey = `talent-withdrawal-settle:${instructionId}`;
    return this.prisma.$transaction(
      async (tx) => {
        const instruction = await tx.paymentInstruction.findUnique({
          where: { id: instructionId },
        });
        if (
          !instruction?.sourceParticipantId ||
          instruction.instructionType !== 'talent_withdrawal'
        ) {
          throw new BadRequestException(
            'Invalid Talent withdrawal instruction',
          );
        }
        const reservations = await tx.talentBalanceReservation.findMany({
          where: { paymentInstructionId: instruction.id },
          include: { lot: true },
        });
        if (!reservations.length)
          throw new BadRequestException(
            'Withdrawal has no balance reservation',
          );
        if (reservations.every((item) => item.status === 'settled'))
          return reservations;
        if (reservations.some((item) => item.status !== 'reserved')) {
          throw new ConflictException(
            'Withdrawal reservations are not settleable',
          );
        }
        const metadata = (instruction.metadata || {}) as Record<
          string,
          unknown
        >;
        const provider = String(metadata.provider || 'provider').toUpperCase();
        const cash = await tx.ledgerAccount.findUnique({
          where: {
            accountCode: `PROVIDER_CASH:${provider}:${instruction.currency}`,
          },
        });
        const liability = await tx.ledgerAccount.findUnique({
          where: {
            accountCode: `TALENT_AP:${instruction.sourceParticipantId}:${instruction.currency}`,
          },
        });
        if (!cash || !liability)
          throw new BadRequestException(
            'Withdrawal ledger accounts are unavailable',
          );
        await this.ledger.postCanonicalTransaction(
          {
            transactionType: 'talent_withdrawal',
            currency: instruction.currency,
            idempotencyKey,
            referenceType: 'PAYMENT_INSTRUCTION',
            referenceId: instruction.id,
            paymentInstructionId: instruction.id,
            description: 'Talent withdrawal settled to external bank',
            metadata: { providerReference },
            postings: [
              {
                accountId: liability.id,
                side: 'debit',
                amount: instruction.amount,
                currency: instruction.currency,
              },
              {
                accountId: cash.id,
                side: 'credit',
                amount: instruction.amount,
                currency: instruction.currency,
              },
            ],
          },
          tx,
        );
        for (const reservation of reservations) {
          const heldAfter = reservation.lot.heldAmount.sub(reservation.amount);
          const withdrawnAfter = reservation.lot.withdrawnAmount.add(
            reservation.amount,
          );
          const status = reservation.lot.availableAmount.isPositive()
            ? 'partially_withdrawn'
            : heldAfter.isPositive()
              ? 'held'
              : 'withdrawn';
          await tx.talentBalanceLot.update({
            where: { id: reservation.lotId },
            data: {
              heldAmount: heldAfter,
              withdrawnAmount: withdrawnAfter,
              status,
            },
          });
          await tx.talentBalanceReservation.update({
            where: { id: reservation.id },
            data: { status: 'settled' },
          });
          await tx.talentBalanceEvent.create({
            data: {
              lotId: reservation.lotId,
              eventType: 'withdrawal_settled',
              amount: reservation.amount,
              availableAfter: reservation.lot.availableAmount,
              heldAfter,
              withdrawnAfter,
              referenceType: 'PAYMENT_INSTRUCTION',
              referenceId: instruction.id,
              idempotencyKey: `${instruction.id}:settle:${reservation.lotId}`,
            },
          });
        }
        return reservations;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async releaseWithdrawal(instructionId: string, reason: string) {
    return this.prisma.$transaction(async (tx) => {
      const reservations = await tx.talentBalanceReservation.findMany({
        where: { paymentInstructionId: instructionId, status: 'reserved' },
        include: { lot: true },
      });
      for (const reservation of reservations) {
        const availableAfter = reservation.lot.availableAmount.add(
          reservation.amount,
        );
        const heldAfter = reservation.lot.heldAmount.sub(reservation.amount);
        await tx.talentBalanceLot.update({
          where: { id: reservation.lotId },
          data: {
            availableAmount: availableAfter,
            heldAmount: heldAfter,
            status: heldAfter.isZero() ? 'available' : 'held',
          },
        });
        await tx.talentBalanceReservation.update({
          where: { id: reservation.id },
          data: { status: 'released' },
        });
        await tx.talentBalanceEvent.create({
          data: {
            lotId: reservation.lotId,
            eventType: 'withdrawal_failed',
            amount: reservation.amount,
            availableAfter,
            heldAfter,
            withdrawnAfter: reservation.lot.withdrawnAmount,
            convertedAfter: reservation.lot.convertedAmount,
            referenceType: 'PAYMENT_INSTRUCTION',
            referenceId: instructionId,
            idempotencyKey: `${instructionId}:release:${reservation.lotId}`,
            reason,
          },
        });
      }
      return reservations;
    });
  }

  async settleConversion(
    instructionId: string,
    destinationAmountValue: number | string | Prisma.Decimal,
    providerReference: string,
  ) {
    const destinationAmount = new Prisma.Decimal(destinationAmountValue);
    if (!destinationAmount.isPositive())
      throw new BadRequestException('Converted amount must be positive');
    return this.prisma.$transaction(
      async (tx) => {
        const instruction = await tx.paymentInstruction.findUnique({
          where: { id: instructionId },
        });
        if (
          !instruction?.sourceParticipantId ||
          instruction.instructionType !== 'balance_conversion'
        ) {
          throw new BadRequestException(
            'Invalid balance conversion instruction',
          );
        }
        const metadata = (instruction.metadata || {}) as Record<
          string,
          unknown
        >;
        const destinationCurrency = String(
          metadata.destinationCurrency || '',
        ).toUpperCase();
        const provider = String(metadata.provider || 'provider').toUpperCase();
        if (
          !/^[A-Z]{3}$/.test(destinationCurrency) ||
          destinationCurrency === instruction.currency
        ) {
          throw new BadRequestException(
            'Invalid conversion destination currency',
          );
        }
        const reservations = await tx.talentBalanceReservation.findMany({
          where: {
            paymentInstructionId: instruction.id,
            reservationType: 'fx_conversion',
          },
          include: { lot: true },
        });
        if (!reservations.length)
          throw new BadRequestException(
            'Conversion has no balance reservation',
          );
        if (reservations.every((item) => item.status === 'settled')) {
          return tx.talentBalanceLot.findUnique({
            where: { paymentInstructionId: instruction.id },
          });
        }
        if (reservations.some((item) => item.status !== 'reserved')) {
          throw new ConflictException(
            'Conversion reservations are not settleable',
          );
        }
        const sourceCash = await tx.ledgerAccount.findUnique({
          where: {
            accountCode: `PROVIDER_CASH:${provider}:${instruction.currency}`,
          },
        });
        const sourceLiability = await tx.ledgerAccount.findUnique({
          where: {
            accountCode: `TALENT_AP:${instruction.sourceParticipantId}:${instruction.currency}`,
          },
        });
        if (!sourceCash || !sourceLiability) {
          throw new BadRequestException(
            'Source currency ledger accounts are unavailable',
          );
        }
        const destinationCash = await tx.ledgerAccount.upsert({
          where: {
            accountCode: `PROVIDER_CASH:${provider}:${destinationCurrency}`,
          },
          update: { status: 'active' },
          create: {
            accountCode: `PROVIDER_CASH:${provider}:${destinationCurrency}`,
            accountType: 'asset',
            name: `${provider} safeguarded cash`,
            currency: destinationCurrency,
            ownerType: 'system',
            purpose: 'provider_cash',
          },
        });
        const destinationLiability = await tx.ledgerAccount.upsert({
          where: {
            accountCode: `TALENT_AP:${instruction.sourceParticipantId}:${destinationCurrency}`,
          },
          update: { status: 'active' },
          create: {
            accountCode: `TALENT_AP:${instruction.sourceParticipantId}:${destinationCurrency}`,
            accountType: 'liability',
            name: 'Talent AP custodial balance',
            currency: destinationCurrency,
            ownerId: instruction.sourceParticipantId,
            ownerType: 'talent',
            participantId: instruction.sourceParticipantId,
            purpose: 'talent_ap_balance',
          },
        });
        await this.ledger.postCanonicalTransaction(
          {
            transactionType: 'fx_conversion_source',
            currency: instruction.currency,
            idempotencyKey: `fx-source:${instruction.id}`,
            referenceType: 'PAYMENT_INSTRUCTION',
            referenceId: instruction.id,
            paymentInstructionId: instruction.id,
            description: 'Talent balance converted out of source currency',
            metadata: { providerReference, destinationCurrency },
            postings: [
              {
                accountId: sourceLiability.id,
                side: 'debit',
                amount: instruction.amount,
                currency: instruction.currency,
              },
              {
                accountId: sourceCash.id,
                side: 'credit',
                amount: instruction.amount,
                currency: instruction.currency,
              },
            ],
          },
          tx,
        );
        await this.ledger.postCanonicalTransaction(
          {
            transactionType: 'fx_conversion_destination',
            currency: destinationCurrency,
            idempotencyKey: `fx-destination:${instruction.id}`,
            referenceType: 'PAYMENT_INSTRUCTION',
            referenceId: instruction.id,
            paymentInstructionId: instruction.id,
            description: 'Talent balance credited in destination currency',
            metadata: {
              providerReference,
              sourceCurrency: instruction.currency,
            },
            postings: [
              {
                accountId: destinationCash.id,
                side: 'debit',
                amount: destinationAmount,
                currency: destinationCurrency,
              },
              {
                accountId: destinationLiability.id,
                side: 'credit',
                amount: destinationAmount,
                currency: destinationCurrency,
              },
            ],
          },
          tx,
        );
        for (const reservation of reservations) {
          const heldAfter = reservation.lot.heldAmount.sub(reservation.amount);
          const convertedAfter = reservation.lot.convertedAmount.add(
            reservation.amount,
          );
          const status = reservation.lot.availableAmount.isPositive()
            ? 'partially_converted'
            : heldAfter.isPositive()
              ? 'held'
              : 'converted';
          await tx.talentBalanceLot.update({
            where: { id: reservation.lotId },
            data: {
              heldAmount: heldAfter,
              convertedAmount: convertedAfter,
              status,
            },
          });
          await tx.talentBalanceReservation.update({
            where: { id: reservation.id },
            data: { status: 'settled' },
          });
          await tx.talentBalanceEvent.create({
            data: {
              lotId: reservation.lotId,
              eventType: 'converted_out',
              amount: reservation.amount,
              availableAfter: reservation.lot.availableAmount,
              heldAfter,
              withdrawnAfter: reservation.lot.withdrawnAmount,
              convertedAfter,
              referenceType: 'PAYMENT_INSTRUCTION',
              referenceId: instruction.id,
              idempotencyKey: `${instruction.id}:converted-out:${reservation.lotId}`,
            },
          });
        }
        return tx.talentBalanceLot.create({
          data: {
            participantId: instruction.sourceParticipantId,
            paymentInstructionId: instruction.id,
            currency: destinationCurrency,
            originalAmount: destinationAmount,
            availableAmount: destinationAmount,
            status: 'available',
            availableAt: new Date(),
            events: {
              create: {
                eventType: 'converted_in',
                amount: destinationAmount,
                availableAfter: destinationAmount,
                heldAfter: 0,
                withdrawnAfter: 0,
                convertedAfter: 0,
                referenceType: 'PAYMENT_INSTRUCTION',
                referenceId: instruction.id,
                idempotencyKey: `${instruction.id}:converted-in`,
                reason: `Converted from ${instruction.currency}`,
              },
            },
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async releaseConversion(instructionId: string, reason: string) {
    return this.releaseReservation(instructionId, 'fx_conversion', reason);
  }

  private async releaseReservation(
    instructionId: string,
    reservationType: 'withdrawal' | 'fx_conversion',
    reason: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const reservations = await tx.talentBalanceReservation.findMany({
        where: {
          paymentInstructionId: instructionId,
          reservationType,
          status: 'reserved',
        },
        include: { lot: true },
      });
      for (const reservation of reservations) {
        const availableAfter = reservation.lot.availableAmount.add(
          reservation.amount,
        );
        const heldAfter = reservation.lot.heldAmount.sub(reservation.amount);
        await tx.talentBalanceLot.update({
          where: { id: reservation.lotId },
          data: {
            availableAmount: availableAfter,
            heldAmount: heldAfter,
            status: heldAfter.isZero() ? 'available' : 'held',
          },
        });
        await tx.talentBalanceReservation.update({
          where: { id: reservation.id },
          data: { status: 'released' },
        });
        await tx.talentBalanceEvent.create({
          data: {
            lotId: reservation.lotId,
            eventType:
              reservationType === 'withdrawal'
                ? 'withdrawal_failed'
                : 'released',
            amount: reservation.amount,
            availableAfter,
            heldAfter,
            withdrawnAfter: reservation.lot.withdrawnAmount,
            referenceType: 'PAYMENT_INSTRUCTION',
            referenceId: instructionId,
            idempotencyKey: `${instructionId}:release:${reservation.lotId}`,
            reason,
          },
        });
      }
      return reservations;
    });
  }
}

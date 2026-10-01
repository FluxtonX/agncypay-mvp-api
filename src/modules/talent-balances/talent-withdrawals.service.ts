import {
  BadGatewayException,
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PaymentOrchestrationService } from '../payment-orchestration/payment-orchestration.service';
import { TalentBalancesService } from './talent-balances.service';
import { PAYMENT_PROVIDER } from '../../core/interfaces/payment-provider.interface';
import type { PaymentProvider } from '../../core/interfaces/payment-provider.interface';

@Injectable()
export class TalentWithdrawalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orchestration: PaymentOrchestrationService,
    private readonly balances: TalentBalancesService,
    @Inject(PAYMENT_PROVIDER) private readonly paymentProvider: PaymentProvider,
  ) {}

  async request(
    userId: string,
    input: {
      amount: number | string;
      currency?: string;
      destinationFinancialAccountId: string;
      idempotencyKey: string;
    },
  ) {
    const participantLink = await this.prisma.participantUser.findUnique({
      where: { userId },
    });
    if (!participantLink)
      throw new NotFoundException('Talent participant identity not found');
    const currency = String(input.currency || 'USD').toUpperCase();
    const destination = await this.prisma.financialAccount.findFirst({
      where: {
        id: input.destinationFinancialAccountId,
        participantId: participantLink.participantId,
        type: 'external_bank',
        status: 'ready',
        currency,
        deletedAt: null,
        providerAccounts: {
          some: { provider: this.paymentProvider.name, status: 'active' },
        },
      },
      include: { providerAccounts: true },
    });
    if (!destination)
      throw new BadRequestException(
        'Verified Talent destination bank is not ready',
      );
    const platformParty = await this.prisma.providerPartyMap.findFirst({
      where: {
        provider: this.paymentProvider.name,
        status: 'active',
        organization: { type: 'platform', status: 'active' },
      },
    });
    if (!platformParty)
      throw new BadRequestException('Platform payout rail is not configured');
    const providerAccount = destination.providerAccounts.find(
      (item) =>
        item.provider === this.paymentProvider.name && item.status === 'active',
    )!;
    const created = await this.orchestration.createInstruction({
      instructionType: 'talent_withdrawal',
      sourceParticipantId: participantLink.participantId,
      destinationParticipantId: participantLink.participantId,
      destinationFinancialAccountId: destination.id,
      amount: input.amount,
      currency,
      providerRequired: true,
      purpose: 'talent_balance_withdrawal',
      idempotencyScope: `${participantLink.participantId}:talent-withdrawal`,
      idempotencyKey: input.idempotencyKey,
      requestedById: userId,
      metadata: { provider: this.paymentProvider.name },
    });
    let instruction = created.instruction;
    if (
      ['settled', 'processing', 'submitted', 'failed'].includes(
        instruction.status,
      )
    ) {
      return { instruction, duplicate: true };
    }
    if (instruction.status === 'requested') {
      try {
        await this.balances.reserveWithdrawal(instruction.id);
      } catch (error: any) {
        await this.orchestration.transitionInstruction(
          instruction.id,
          'failed',
          {
            actorId: userId,
            failureCode: 'INSUFFICIENT_AVAILABLE_BALANCE',
            reason: error.message,
          },
        );
        throw error;
      }
      instruction = await this.orchestration.transitionInstruction(
        instruction.id,
        'validated',
        {
          actorId: userId,
          reason: 'Talent balance reserved for withdrawal',
        },
      );
    }
    if (instruction.status === 'validated') {
      instruction = await this.orchestration.transitionInstruction(
        instruction.id,
        'awaiting_provider',
        {
          actorId: userId,
        },
      );
    }
    if (instruction.status !== 'awaiting_provider')
      return { instruction, duplicate: created.duplicate };
    const begun = await this.orchestration.beginProviderAttempt({
      instructionId: instruction.id,
      provider: this.paymentProvider.name,
      operationType: 'talent_withdrawal',
      idempotencyKey: `${instruction.id}:withdrawal`,
      requestPayload: {
        partyId: platformParty.externalId,
        recipientId: providerAccount.externalId,
        amount: instruction.amount.toString(),
        currency,
      },
    });
    if (begun.attempt.status === 'requested') {
      await this.orchestration.transitionAttempt(begun.attempt.id, 'submitted');
    }
    await this.orchestration.transitionInstruction(
      instruction.id,
      'submitted',
      {
        actorId: userId,
        reason: 'Talent withdrawal submitted to payment provider',
      },
    );
    try {
      const result = await this.paymentProvider.createTransfer({
        partyId: platformParty.externalId,
        recipientId: providerAccount.externalId,
        amount: Number(instruction.amount),
        currency,
        purpose: 'talent_balance_withdrawal',
        reference: instruction.id,
        idempotencyKey: `${instruction.id}:withdrawal`,
        metadata: {
          paymentInstructionId: instruction.id,
          participantId: participantLink.participantId,
        },
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
        await this.balances.settleWithdrawal(instruction.id, result.id);
        instruction = await this.orchestration.transitionInstruction(
          instruction.id,
          'settled',
          {
            actorId: userId,
            reason: 'Talent withdrawal settled to external bank',
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
        instruction = await this.orchestration.transitionInstruction(
          instruction.id,
          'processing',
          {
            actorId: userId,
            reason: 'Talent withdrawal accepted by payment provider',
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
      await this.balances.releaseWithdrawal(instruction.id, error.message);
      await this.orchestration.transitionInstruction(instruction.id, 'failed', {
        actorId: userId,
        failureCode: 'TALENT_WITHDRAWAL_FAILED',
        reason: error.message,
      });
      throw new BadGatewayException(
        `Talent withdrawal failed: ${error.message}`,
      );
    }
    return { instruction, duplicate: created.duplicate };
  }
}

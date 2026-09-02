import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';

export type PayoutStatus =
  | 'CREATED'
  | 'RESERVED'
  | 'VALIDATING'
  | 'QUOTE_PENDING'
  | 'TRANSFER_PENDING'
  | 'TRADE_PENDING'
  | 'TRADE_COMPLETED'
  | 'REMITTANCE_PENDING'
  | 'REMITTANCE_PROCESSING'
  | 'REMITTANCE_COMPLETED'
  | 'EXECUTION_PENDING'
  | 'COMPLETED'
  | 'FAILED'
  | 'RETURNED'
  | 'CANCELLED';

/** Terminal states — once entered, no forward webhook can override */
export const TERMINAL_PAYOUT_STATES: PayoutStatus[] = ['COMPLETED', 'FAILED', 'RETURNED', 'CANCELLED'];

@Injectable()
export class PayoutStateService {
  private readonly logger = new Logger(PayoutStateService.name);

  private readonly validTransitions: Record<PayoutStatus, PayoutStatus[]> = {
    CREATED: ['RESERVED', 'VALIDATING', 'FAILED', 'CANCELLED'],
    RESERVED: ['VALIDATING', 'FAILED', 'CANCELLED'],
    VALIDATING: ['QUOTE_PENDING', 'TRANSFER_PENDING', 'TRADE_PENDING', 'FAILED', 'CANCELLED'],
    QUOTE_PENDING: ['TRANSFER_PENDING', 'TRADE_PENDING', 'FAILED', 'CANCELLED'],
    // Domestic
    TRANSFER_PENDING: ['COMPLETED', 'FAILED', 'RETURNED'],
    // International
    TRADE_PENDING: ['TRADE_COMPLETED', 'FAILED'],
    TRADE_COMPLETED: ['REMITTANCE_PENDING', 'FAILED'],
    REMITTANCE_PENDING: ['EXECUTION_PENDING', 'REMITTANCE_PROCESSING', 'FAILED'],
    REMITTANCE_PROCESSING: ['REMITTANCE_COMPLETED', 'FAILED'],
    REMITTANCE_COMPLETED: ['COMPLETED', 'FAILED'],
    EXECUTION_PENDING: ['REMITTANCE_PROCESSING', 'COMPLETED', 'FAILED', 'RETURNED'],
    COMPLETED: ['RETURNED'],
    FAILED: [],
    RETURNED: [],
    CANCELLED: [],
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  canTransition(current: PayoutStatus, target: PayoutStatus): boolean {
    const allowed = this.validTransitions[current] || [];
    return allowed.includes(target);
  }

  async transition(
    payoutId: string,
    targetState: PayoutStatus,
    details?: {
      reason?: string;
      stage?: string;
      providerRef?: string;
      userId?: string;
    },
  ) {
    const payout = await this.prisma.paymentPayout.findUnique({
      where: { id: payoutId },
    });

    if (!payout) {
      throw new BadRequestException(`Payout ${payoutId} not found`);
    }

    const currentState = payout.status as PayoutStatus;

    if (currentState === targetState) {
      return payout;
    }

    if (!this.canTransition(currentState, targetState)) {
      throw new BadRequestException(
        `Invalid payout transition from ${currentState} to ${targetState}`,
      );
    }

    const updateData: any = { status: targetState };

    if (targetState === 'COMPLETED') {
      updateData.completedAt = new Date();
    } else if (targetState === 'FAILED' || targetState === 'RETURNED' || targetState === 'CANCELLED') {
      updateData.failedAt = new Date();
      updateData.failureReason = details?.reason;
      updateData.failureStage = details?.stage || currentState;
    }

    const updated = await this.prisma.paymentPayout.update({
      where: { id: payoutId },
      data: updateData,
    });

    await this.auditLogsService.log({
      userId: details?.userId || payout.agencyId,
      action: `PAYOUT_STATE_${targetState}`,
      entityType: 'PaymentPayout',
      entityId: payoutId,
      details: {
        previousState: currentState,
        newState: targetState,
        reason: details?.reason,
        stage: details?.stage,
        providerRef: details?.providerRef,
      },
    });

    this.logger.log(`Payout [${payoutId}] transitioned: ${currentState} → ${targetState}`);

    return updated;
  }
}

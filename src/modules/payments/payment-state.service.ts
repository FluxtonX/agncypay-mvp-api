import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';

export type PaymentStatus =
  | 'CREATED'
  | 'PENDING_FUNDING'
  | 'FUNDED'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'FAILED'
  | 'RETURNED'
  | 'REVIEW';

@Injectable()
export class PaymentStateService {
  private readonly logger = new Logger(PaymentStateService.name);

  private readonly validTransitions: Record<PaymentStatus, PaymentStatus[]> = {
    CREATED: ['PENDING_FUNDING', 'FAILED'],
    PENDING_FUNDING: ['FUNDED', 'COMPLETED', 'FAILED', 'REVIEW'],
    FUNDED: ['PROCESSING', 'COMPLETED', 'FAILED'],
    PROCESSING: ['COMPLETED', 'FAILED', 'RETURNED', 'REVIEW'],
    COMPLETED: ['RETURNED'], // e.g. ACH chargeback/return
    FAILED: ['REVIEW'],
    RETURNED: ['REVIEW'],
    REVIEW: ['PENDING_FUNDING', 'FUNDED', 'FAILED'],
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  canTransition(current: PaymentStatus, target: PaymentStatus): boolean {
    const allowed = this.validTransitions[current] || [];
    return allowed.includes(target);
  }

  async transition(
    paymentId: string,
    targetState: PaymentStatus,
    details?: {
      reason?: string;
      stage?: string;
      providerRef?: string;
      userId?: string;
    },
  ) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
    });

    if (!payment) {
      throw new BadRequestException(`Payment ${paymentId} not found`);
    }

    const currentState = payment.status as PaymentStatus;

    if (currentState === targetState) {
      this.logger.debug(`Payment ${paymentId} already in state ${targetState}`);
      return payment;
    }

    if (!this.canTransition(currentState, targetState)) {
      throw new BadRequestException(
        `Invalid payment transition from ${currentState} to ${targetState}`,
      );
    }

    const updateData: any = { status: targetState };

    if (targetState === 'FUNDED') {
      updateData.fundedAt = new Date();
    } else if (targetState === 'COMPLETED') {
      updateData.completedAt = new Date();
    } else if (targetState === 'FAILED' || targetState === 'RETURNED') {
      updateData.failedAt = new Date();
      updateData.failureReason = details?.reason;
      updateData.failureStage = details?.stage || currentState;
    }

    const updated = await this.prisma.payment.update({
      where: { id: paymentId },
      data: updateData,
    });

    await this.auditLogsService.log({
      userId: details?.userId || payment.agencyId,
      action: `PAYMENT_STATE_${targetState}`,
      entityType: 'Payment',
      entityId: paymentId,
      details: {
        previousState: currentState,
        newState: targetState,
        reason: details?.reason,
        stage: details?.stage,
        providerRef: details?.providerRef,
      },
    });

    this.logger.log(`Payment [${paymentId}] transitioned: ${currentState} → ${targetState}`);

    return updated;
  }
}

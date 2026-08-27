import { Test, TestingModule } from '@nestjs/testing';
import { PayoutStateService } from './payout-state.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { BadRequestException } from '@nestjs/common';

describe('PayoutStateService', () => {
  let service: PayoutStateService;

  const mockPrismaService = {
    paymentPayout: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };

  const mockAuditLogsService = {
    log: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PayoutStateService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: AuditLogsService, useValue: mockAuditLogsService },
      ],
    }).compile();

    service = module.get<PayoutStateService>(PayoutStateService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should support domestic payout transition flow', () => {
    expect(service.canTransition('CREATED', 'VALIDATING')).toBe(true);
    expect(service.canTransition('VALIDATING', 'QUOTE_PENDING')).toBe(true);
    expect(service.canTransition('QUOTE_PENDING', 'TRANSFER_PENDING')).toBe(true);
    expect(service.canTransition('TRANSFER_PENDING', 'COMPLETED')).toBe(true);
  });

  it('should support international payout multi-step transition flow', () => {
    expect(service.canTransition('QUOTE_PENDING', 'TRADE_PENDING')).toBe(true);
    expect(service.canTransition('TRADE_PENDING', 'TRADE_COMPLETED')).toBe(true);
    expect(service.canTransition('TRADE_COMPLETED', 'REMITTANCE_PENDING')).toBe(true);
    expect(service.canTransition('REMITTANCE_PENDING', 'EXECUTION_PENDING')).toBe(true);
    expect(service.canTransition('EXECUTION_PENDING', 'COMPLETED')).toBe(true);
  });

  it('should record failure stage and reason on failure', async () => {
    mockPrismaService.paymentPayout.findUnique.mockResolvedValue({
      id: 'po-1',
      status: 'TRADE_PENDING',
      agencyId: 'agency-1',
    });

    mockPrismaService.paymentPayout.update.mockResolvedValue({
      id: 'po-1',
      status: 'FAILED',
      failureReason: 'Insufficient FX liquidity',
      failureStage: 'FX_TRADE',
    });

    const result = await service.transition('po-1', 'FAILED', {
      reason: 'Insufficient FX liquidity',
      stage: 'FX_TRADE',
    });

    expect(result.status).toBe('FAILED');
    expect(mockPrismaService.paymentPayout.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'FAILED',
          failureReason: 'Insufficient FX liquidity',
          failureStage: 'FX_TRADE',
        }),
      }),
    );
  });
});

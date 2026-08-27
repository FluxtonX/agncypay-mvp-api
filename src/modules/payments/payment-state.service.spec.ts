import { Test, TestingModule } from '@nestjs/testing';
import { PaymentStateService } from './payment-state.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { BadRequestException } from '@nestjs/common';

describe('PaymentStateService', () => {
  let service: PaymentStateService;
  let prisma: PrismaService;

  const mockPrismaService = {
    payment: {
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
        PaymentStateService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: AuditLogsService, useValue: mockAuditLogsService },
      ],
    }).compile();

    service = module.get<PaymentStateService>(PaymentStateService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should validate valid transitions correctly', () => {
    expect(service.canTransition('CREATED', 'PENDING_FUNDING')).toBe(true);
    expect(service.canTransition('PENDING_FUNDING', 'FUNDED')).toBe(true);
    expect(service.canTransition('FUNDED', 'COMPLETED')).toBe(true);
  });

  it('should reject invalid transitions', () => {
    expect(service.canTransition('CREATED', 'COMPLETED')).toBe(false);
    expect(service.canTransition('FAILED', 'COMPLETED')).toBe(false);
  });

  it('should execute transition and log audit', async () => {
    mockPrismaService.payment.findUnique.mockResolvedValue({
      id: 'pay-1',
      status: 'PENDING_FUNDING',
      agencyId: 'agency-1',
    });

    mockPrismaService.payment.update.mockResolvedValue({
      id: 'pay-1',
      status: 'FUNDED',
    });

    const result = await service.transition('pay-1', 'FUNDED', { providerRef: 'tra-123' });
    expect(result.status).toBe('FUNDED');
    expect(mockAuditLogsService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'PAYMENT_STATE_FUNDED',
        entityId: 'pay-1',
      }),
    );
  });

  it('should throw BadRequestException on invalid transition', async () => {
    mockPrismaService.payment.findUnique.mockResolvedValue({
      id: 'pay-1',
      status: 'CREATED',
      agencyId: 'agency-1',
    });

    await expect(service.transition('pay-1', 'COMPLETED')).rejects.toThrow(BadRequestException);
  });
});

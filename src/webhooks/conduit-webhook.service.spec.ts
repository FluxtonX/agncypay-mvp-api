import { ConflictException } from '@nestjs/common';
import { ConduitWebhookService } from './conduit-webhook.service';

describe('ConduitWebhookService', () => {
  it('persists, safely replays, and rejects conflicting provider event IDs', async () => {
    let stored: any;
    const prisma: any = {
      providerWebhookEvent: {
        findUnique: jest.fn().mockImplementation(async () => stored || null),
        create: jest.fn().mockImplementation(async ({ data }) => {
          stored = { id: 'event-1', status: 'received', attempts: 0, ...data };
          return stored;
        }),
        updateMany: jest.fn().mockImplementation(async ({ data }) => {
          if (!stored || !['received', 'failed'].includes(stored.status))
            return { count: 0 };
          stored = {
            ...stored,
            status: data.status,
            attempts: stored.attempts + 1,
          };
          return { count: 1 };
        }),
        update: jest.fn().mockImplementation(async ({ data }) => {
          stored = { ...stored, ...data };
          return stored;
        }),
      },
      paymentAttempt: { findFirst: jest.fn().mockResolvedValue(null) },
      reconciliationRecord: {
        upsert: jest.fn().mockResolvedValue({ id: 'issue-1' }),
      },
    };
    const provider: any = {
      name: 'conduit',
      verifyWebhookSignature: jest.fn().mockReturnValue(true),
    };
    const service = new ConduitWebhookService(
      prisma,
      {} as any,
      {} as any,
      {} as any,
      provider,
    );
    const payload = {
      event: 'transaction.created',
      data: { id: 'txn-unmapped', status: 'created' },
    };
    const input = {
      signature: 'valid',
      timestamp: '1',
      rawBody: '{}',
      payload,
      eventId: 'provider-event-1',
    };

    await expect(service.processWebhook(input)).resolves.toMatchObject({
      status: 'ignored',
      duplicate: false,
    });
    await expect(service.processWebhook(input)).resolves.toMatchObject({
      status: 'ignored',
      duplicate: true,
    });
    expect(prisma.reconciliationRecord.upsert).toHaveBeenCalledTimes(1);

    await expect(
      service.processWebhook({
        ...input,
        payload: {
          ...payload,
          data: { ...payload.data, status: 'processing' },
        },
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

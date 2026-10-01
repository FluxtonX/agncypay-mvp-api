import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { SourceConnectionsService } from './source-connections.service';

describe('SourceConnectionsService', () => {
  it('authenticates only the random secret issued for a CRM connection', async () => {
    let storedHash = '';
    const prisma: any = {
      organization: {
        findFirst: jest.fn().mockResolvedValue({ id: 'org-1', name: 'Agency' }),
      },
      sourceConnection: {
        create: jest.fn().mockImplementation(({ data }) => {
          storedHash = data.webhookSecretHash;
          return { id: 'connection-1', ...data };
        }),
        findFirst: jest.fn().mockImplementation(({ where }) =>
          Promise.resolve({
            id: 'connection-1',
            organizationId: 'org-1',
            connectorKey: 'generic_crm',
            status: 'active',
            webhookSecretHash: storedHash,
            organization: { id: 'org-1' },
            ...where,
          }),
        ),
      },
    };
    const service = new SourceConnectionsService(prisma);
    const created = await service.createCrmWebhookConnection('agency-user');

    await expect(
      service.authenticateCrmApiKey(created.apiKey),
    ).resolves.toMatchObject({
      id: 'connection-1',
      organizationId: 'org-1',
    });
    await expect(
      service.authenticateCrmApiKey('agncy_crm_connection-1.wrong-secret'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('deduplicates canonical payloads and rejects event ID payload conflicts', async () => {
    let persisted: any = null;
    const prisma: any = {
      sourceEvent: {
        findUnique: jest
          .fn()
          .mockImplementation(() => Promise.resolve(persisted)),
        create: jest.fn().mockImplementation(({ data }) => {
          persisted = { id: 'event-row-1', status: 'received', ...data };
          return persisted;
        }),
      },
    };
    const service = new SourceConnectionsService(prisma);
    const first = await service.receiveEvent({
      connectionId: 'connection-1',
      externalEventId: 'event-1',
      eventType: 'talent.sync',
      payload: {
        event: 'talent.sync',
        data: { email: 'a@example.test', name: 'A' },
      },
    });
    const replay = await service.receiveEvent({
      connectionId: 'connection-1',
      externalEventId: 'event-1',
      eventType: 'talent.sync',
      payload: {
        data: { name: 'A', email: 'a@example.test' },
        event: 'talent.sync',
      },
    });

    expect(first.duplicate).toBe(false);
    expect(replay.duplicate).toBe(true);
    await expect(
      service.receiveEvent({
        connectionId: 'connection-1',
        externalEventId: 'event-1',
        eventType: 'talent.sync',
        payload: { event: 'talent.sync', data: { name: 'Changed' } },
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

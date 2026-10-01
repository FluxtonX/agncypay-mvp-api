import { ReconciliationService } from './reconciliation.service';

describe('ReconciliationService', () => {
  it('detects and deduplicates provider status discrepancies', async () => {
    const records = new Map<string, any>();
    const attempt: any = {
      id: 'attempt-1',
      provider: 'conduit',
      operationType: 'agency_disbursement',
      status: 'submitted',
      externalReference: 'txn-1',
      instruction: { amount: 100, currency: 'USD' },
    };
    const prisma: any = {
      paymentAttempt: { findMany: jest.fn().mockResolvedValue([attempt]) },
      providerWebhookEvent: { count: jest.fn().mockResolvedValue(0) },
      reconciliationRecord: {
        findUnique: jest
          .fn()
          .mockImplementation(
            async ({ where }) => records.get(where.dedupeKey) || null,
          ),
        upsert: jest
          .fn()
          .mockImplementation(async ({ where, create, update }) => {
            const value = records.has(where.dedupeKey)
              ? { ...records.get(where.dedupeKey), ...update }
              : { id: `record-${records.size + 1}`, ...create };
            records.set(where.dedupeKey, value);
            return value;
          }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    const ledger: any = {
      getCanonicalTrialBalance: jest.fn().mockResolvedValue({
        totalDebits: '100',
        totalCredits: '100',
        discrepancy: '0',
        isBalanced: true,
      }),
    };
    const provider: any = {
      getTransfer: jest.fn().mockResolvedValue({
        id: 'txn-1',
        status: 'completed',
        amount: 100,
        currency: 'USD',
      }),
    };
    const service = new ReconciliationService(
      prisma,
      {} as any,
      ledger,
      provider,
    );

    await expect(service.runReconciliation()).resolves.toMatchObject({
      discrepanciesFound: 1,
      recordsCreated: 1,
    });
    await expect(service.runReconciliation()).resolves.toMatchObject({
      discrepanciesFound: 1,
      recordsCreated: 0,
    });
    expect(records.size).toBe(1);
  });
});

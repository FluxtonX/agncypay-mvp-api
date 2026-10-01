import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConduitProvider } from './conduit.provider';
import { FakePaymentProvider } from '../fake/fake-payment.provider';
import * as crypto from 'crypto';

describe('PaymentProvider adapters', () => {
  it('never simulates a Conduit transfer when credentials are absent', async () => {
    const config = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'CONDUIT_BASE_URL') return 'https://conduit.invalid/v2';
        return undefined;
      }),
    } as unknown as ConfigService;
    const provider = new ConduitProvider(config);

    expect(provider.isConfigured()).toBe(false);
    await expect(
      provider.createTransfer({
        partyId: 'party-1',
        recipientId: 'recipient-1',
        amount: 100,
        currency: 'USD',
        idempotencyKey: 'transfer-1',
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(provider.verifyWebhookSignature('', '{}')).toBe(false);
  });

  it('keeps simulation inside the explicitly selected fake adapter', async () => {
    const provider = new FakePaymentProvider();
    const result = await provider.createTransfer({
      partyId: 'party-1',
      recipientId: 'recipient-1',
      amount: 125.5,
      currency: 'USD',
      idempotencyKey: 'transfer-1',
    });

    expect(provider.name).toBe('fake');
    expect(result.status).toBe('completed');
    expect(result.amount).toBe(125.5);
    expect(result.currency).toBe('USD');
  });

  it('exposes FX through the provider-neutral adapter contract', async () => {
    const provider = new FakePaymentProvider();
    const quote = await provider.createFxQuote({
      sourceCurrency: 'USD',
      destinationCurrency: 'EUR',
      sourceAmount: 100,
      idempotencyKey: 'quote-1',
    });
    const conversion = await provider.executeFxConversion({
      quoteId: quote.id,
      sourceAccountId: 'account-1',
      destinationAccountId: 'account-1',
      idempotencyKey: 'conversion-1',
    });

    expect(quote.sourceAmount).toBe(100);
    expect(quote.destinationAmount).toBe(90);
    expect(quote.exchangeRate).toBe(0.9);
    expect(conversion.status).toBe('completed');
  });

  it('verifies the official timestamped Conduit webhook signature', () => {
    const secret = 'webhook-test-secret';
    const config = {
      get: jest
        .fn()
        .mockImplementation((key: string) =>
          key === 'CONDUIT_WEBHOOK_SECRET' ? secret : undefined,
        ),
    } as unknown as ConfigService;
    const provider = new ConduitProvider(config);
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const rawBody = '{"event":"transaction.completed","data":{"id":"txn-1"}}';
    const signature = crypto
      .createHmac('sha256', secret)
      .update(`${timestamp}.${rawBody}`)
      .digest('hex');

    expect(provider.verifyWebhookSignature(signature, rawBody, timestamp)).toBe(
      true,
    );
    expect(
      provider.verifyWebhookSignature(signature, `${rawBody} `, timestamp),
    ).toBe(false);
    expect(provider.verifyWebhookSignature(signature, rawBody, '1')).toBe(
      false,
    );
  });
});

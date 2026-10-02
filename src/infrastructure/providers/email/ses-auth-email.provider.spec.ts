import { ConfigService } from '@nestjs/config';
import { SESv2Client } from '@aws-sdk/client-sesv2';
import { SesAuthEmailProvider } from './ses-auth-email.provider';

describe('SesAuthEmailProvider', () => {
  afterEach(() => jest.restoreAllMocks());

  it('sends a token link through SES without returning the token', async () => {
    const send = jest
      .spyOn(SESv2Client.prototype, 'send')
      .mockResolvedValue({ MessageId: 'ses-message-1' } as never);
    const config = new ConfigService({
      AWS_REGION: 'us-east-1',
      AUTH_EMAIL_FROM: 'AgncyPay <no-reply@agncy.xyz>',
      FRONTEND_URL: 'https://staging.agncy.xyz',
    });
    const provider = new SesAuthEmailProvider(config);

    await expect(
      provider.send({
        to: 'talent@example.test',
        purpose: 'verify_email',
        token: 'one-time-token',
        expiresAt: new Date('2026-10-03T00:00:00.000Z'),
      }),
    ).resolves.toEqual({ id: 'ses-message-1', mode: 'email' });

    expect(send).toHaveBeenCalledTimes(1);
    const command = send.mock.calls[0][0] as unknown as {
      input: {
        Destination: { ToAddresses: string[] };
        Content: { Simple: { Body: { Text: { Data: string } } } };
      };
    };
    expect(command.input.Destination.ToAddresses).toEqual([
      'talent@example.test',
    ]);
    expect(command.input.Content.Simple.Body.Text.Data).toContain(
      'token=one-time-token',
    );
  });

  it('fails closed when required SES configuration is missing', async () => {
    const provider = new SesAuthEmailProvider(
      new ConfigService({ AWS_REGION: 'us-east-1' }),
    );

    await expect(
      provider.send({
        to: 'talent@example.test',
        purpose: 'verify_email',
        token: 'token',
        expiresAt: new Date(),
      }),
    ).rejects.toThrow('AUTH_EMAIL_FROM is required');
  });
});

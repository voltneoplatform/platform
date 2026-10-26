import type { SendEmailCommand } from '@aws-sdk/client-sesv2';
import { SesOtpSender } from './otp-sender';

const ses = {
  region: 'ap-south-1',
  from: 'Volt Neo <no-reply@voltcompany.in>',
  accessKeyId: 'AKIAEXAMPLE',
  secretAccessKey: 'x'.repeat(40),
};

describe('SesOtpSender', () => {
  it('emails the code from the configured address', async () => {
    const sent: SendEmailCommand[] = [];
    const sender = new SesOtpSender(ses, 5, true, { send: async (c) => void sent.push(c) });
    expect(sender.channels.has('EMAIL')).toBe(true);
    expect(sender.channels.has('SMS')).toBe(false);
    await sender.send({
      channel: 'EMAIL',
      destination: 'mitra@voltcompany.in',
      code: '482913',
      recipientName: 'Mitra',
    });
    expect(sent).toHaveLength(1);
    const input = sent[0]!.input;
    expect(input.FromEmailAddress).toBe('Volt Neo <no-reply@voltcompany.in>');
    expect(input.Destination?.ToAddresses).toEqual(['mitra@voltcompany.in']);
    expect(input.Content?.Simple?.Subject?.Data).toBe(
      '[Test site] Your Volt Neo sign-in code: 482913',
    );
    expect(input.Content?.Simple?.Body?.Text?.Data).toContain('expires in 5 minutes');
  });

  it('has no test-site prefix in production and refuses SMS', async () => {
    const sent: SendEmailCommand[] = [];
    const sender = new SesOtpSender(ses, 5, false, { send: async (c) => void sent.push(c) });
    await sender.send({
      channel: 'EMAIL',
      destination: 'a@b.in',
      code: '111111',
      recipientName: 'A',
    });
    expect(sent[0]!.input.Content?.Simple?.Subject?.Data).toBe(
      'Your Volt Neo sign-in code: 111111',
    );
    await expect(
      sender.send({ channel: 'SMS', destination: '+919800000000', code: '1', recipientName: 'A' }),
    ).rejects.toThrow(/email only/);
  });
});

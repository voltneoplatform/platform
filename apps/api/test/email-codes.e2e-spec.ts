import type { SendEmailCommand } from '@aws-sdk/client-sesv2';
import { OTP_SENDER, SesOtpSender } from '../src/auth/otp-sender';
import { createStaff, createTestApp, resetData, type TestContext } from './helpers';

/** The test site emails codes through SES and has no SMS provider yet. */
describe('Email sign-in codes (SES)', () => {
  let ctx: TestContext;
  const sent: SendEmailCommand[] = [];

  beforeAll(async () => {
    const sender = new SesOtpSender(
      {
        region: 'ap-south-1',
        from: 'Volt Neo <no-reply@voltcompany.in>',
        accessKeyId: 'AKIAEXAMPLE',
        secretAccessKey: 'x'.repeat(40),
      },
      5,
      true,
      { send: async (c) => void sent.push(c) },
    );
    ctx = await createTestApp((b) => b.overrideProvider(OTP_SENDER).useValue(sender));
  });
  beforeEach(async () => {
    await resetData(ctx.prisma);
    sent.length = 0;
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  it('emails the code to staff who sign in with email', async () => {
    await createStaff(ctx.prisma, 'FINANCE', { email: 'mitra@voltcompany.in' });
    await ctx.http
      .post('/v1/auth/otp/request')
      .send({ identifier: 'mitra@voltcompany.in' })
      .expect(202);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.input.Destination?.ToAddresses).toEqual(['mitra@voltcompany.in']);
  });

  it('sends a code asked for by mobile number to the email on that account, until SMS is on', async () => {
    // Founder, 10 Nov 2026.
    await createStaff(ctx.prisma, 'FIELD_AGENT', {
      phone: '+919830012345',
      email: 'agent@voltcompany.in',
    });
    await createStaff(ctx.prisma, 'TECHNICIAN', { phone: '+919830054321', email: null });
    // The same reply whether or not the number is registered or has an email.
    for (const identifier of ['9830012345', '9830099999', '9830054321']) {
      const res = await ctx.http.post('/v1/auth/otp/request').send({ identifier }).expect(202);
      expect(res.body).toMatchObject({ sent: true, via: 'EMAIL' });
    }
    expect(sent).toHaveLength(1);
    expect(sent[0]!.input.Destination?.ToAddresses).toEqual(['agent@voltcompany.in']);
    const body = JSON.stringify(sent[0]!.input.Content);
    const code = /\b(\d{6})\b/.exec(body)![1]!;
    const session = await ctx.http
      .post('/v1/auth/otp/verify')
      .send({ identifier: '98300 12345', code })
      .expect(200);
    expect(session.body.staff.role).toBe('FIELD_AGENT');
  });
});

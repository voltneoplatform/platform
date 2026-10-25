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

  it('tells phone sign-ins to use email, whether or not the number is registered', async () => {
    await createStaff(ctx.prisma, 'FIELD_AGENT', { phone: '+919830012345' });
    for (const identifier of ['9830012345', '9830099999']) {
      const res = await ctx.http.post('/v1/auth/otp/request').send({ identifier }).expect(503);
      expect(res.body.message).toMatch(/Sign in with your email address/);
    }
    expect(sent).toHaveLength(0);
  });
});

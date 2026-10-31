import { addDays, rupeesToPaise as r } from '@voltneo/shared';
import {
  DRIVER_CODE_SENDER,
  type MemoryDriverCodeSender,
} from '../src/driver-auth/driver-code-sender';
import { PAYMENT_GATEWAY, type FakeGateway } from '../src/payments/gateway';
import { EMAIL_SENDER, type MemoryEmailSender } from '../src/messaging/email-sender';
import { bearer, createTestApp, loginAs, resetData, type TestContext } from './helpers';
import { activeAgreement } from './fixtures';

type Login = Awaited<ReturnType<typeof loginAs>>;

describe('UPI AutoPay (M6)', () => {
  let ctx: TestContext;
  let codes: MemoryDriverCodeSender;
  let gateway: FakeGateway;
  let pm: Login;
  let ops: Login;
  let finance: Login;
  let a: Awaited<ReturnType<typeof activeAgreement>>;
  let driver: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    codes = ctx.app.get<MemoryDriverCodeSender>(DRIVER_CODE_SENDER);
    gateway = ctx.app.get<FakeGateway>(PAYMENT_GATEWAY);
  });
  beforeEach(async () => {
    ctx.clock.reset();
    await resetData(ctx.prisma);
    gateway.charges.length = 0;
    gateway.cancelledCharges.length = 0;
    pm = await loginAs(ctx, 'PLAN_MANAGER');
    ops = await loginAs(ctx, 'OPERATIONS_MANAGER');
    finance = await loginAs(ctx, 'FINANCE');
    a = await activeAgreement(ctx, { ops: ops.token, finance: finance.token, pm: pm.token });
    await ctx.http.post('/v1/driver-auth/code/request').send({ phone: a.driverPhone }).expect(202);
    const res = await ctx.http
      .post('/v1/driver-auth/code/verify')
      .send({ phone: a.driverPhone, code: codes.lastCodeFor(a.driverPhone) })
      .expect(200);
    driver = res.body.session.accessToken;
  });
  afterEach(() => ctx.clock.reset());
  afterAll(async () => {
    await ctx.app.close();
  });

  const mine = async () =>
    (await ctx.http.get('/v1/me/agreement').set(bearer(driver)).expect(200)).body;
  const staffView = async () =>
    (await ctx.http.get(`/v1/agreements/${a.id}/autopay`).set(bearer(ops.token)).expect(200)).body;
  const run = (date: string) =>
    ctx.http.post('/v1/autopay/run').set(bearer(ops.token)).send({ date }).expect(200);

  async function switchOn(method: 'UPI' | 'ENACH' = 'UPI') {
    const start = await ctx.http
      .post(`/v1/me/agreements/${a.id}/autopay`)
      .set(bearer(driver))
      .send({ method })
      .expect(200);
    const view = await staffView();
    await ctx.http
      .post(`/v1/autopay/mandates/${view.mandate.id}/simulate`)
      .set(bearer(ops.token))
      .send({ status: 'ACTIVE' })
      .expect(200);
    return start.body as { url: string };
  }

  it('lets the driver switch AutoPay on through an approval page, for one instalment at most', async () => {
    const before = await mine();
    expect(before.autopay).toMatchObject({ available: true, status: 'OFF' });
    const start = await ctx.http
      .post(`/v1/me/agreements/${a.id}/autopay`)
      .set(bearer(driver))
      .expect(200);
    const code = /\/autopay\/([A-Za-z0-9]{8})$/.exec(start.body.url)![1];
    const page = await ctx.http.get(`/autopay/${code}`).expect(200);
    expect(page.headers['content-type']).toContain('text/html');
    expect((await mine()).autopay).toMatchObject({ status: 'PENDING', maxAmount: r(3000) });
    const sub = [...gateway.mandates.values()].at(-1)!;
    expect(sub.input).toMatchObject({ maxAmountPaise: r(3000), agreementNumber: a.number });
    expect(sub.input.returnUrl).toMatch(new RegExp(`/autopay/${code}/done$`));

    sub.status = 'ACTIVE';
    const done = await ctx.http.get(`/autopay/${code}/done`).expect(200);
    expect(done.text).toContain('Volt Neo');
    expect((await mine()).autopay.status).toBe('ACTIVE');
    await ctx.http.post(`/v1/me/agreements/${a.id}/autopay`).set(bearer(driver)).expect(409);
  });

  it('takes the instalment on its Due Date and hides Pay for it', async () => {
    await switchOn();
    await run(addDays(a.firstDueDate, -5));
    expect(gateway.charges).toHaveLength(0);
    const raised = await run(addDays(a.firstDueDate, -3));
    expect(raised.body).toMatchObject({ chargesRaised: 1 });
    expect(gateway.charges[0]).toMatchObject({
      amountPaise: r(3000),
      scheduleDate: a.firstDueDate,
    });
    await run(addDays(a.firstDueDate, -2));
    expect(gateway.charges).toHaveLength(1);

    ctx.clock.set(addDays(a.firstDueDate, -2));
    const view = await mine();
    expect(view.due).toMatchObject({ kind: 'UPCOMING', amount: r(3000) });
    expect(view.dueByAutopay).toBe(true);
    expect(view.autopay.nextCharge).toMatchObject({ amount: r(3000), date: a.firstDueDate });
    const pay = await ctx.http
      .post(`/v1/me/agreements/${a.id}/pay`)
      .set(bearer(driver))
      .expect(409);
    expect(pay.body.code).toBe('AUTOPAY_SCHEDULED');

    const charge = (await staffView()).mandate.charges[0];
    await ctx.http
      .post(`/v1/autopay/charges/${charge.id}/simulate`)
      .set(bearer(ops.token))
      .send({ status: 'SUCCESS' })
      .expect(200);
    const after = await mine();
    expect(after.schedule[1]).toMatchObject({ sequence: 1, status: 'PAID' });
    const receipts = await ctx.http.get('/v1/me/payments').set(bearer(driver)).expect(200);
    expect(receipts.body[0]).toMatchObject({ amount: r(3000), method: 'UPI' });
    expect(ctx.messages.sent.some((m) => m.template === 'payment_receipt')).toBe(true);
  });

  it('cancels a charge for an instalment already paid another way', async () => {
    await switchOn();
    await run(addDays(a.firstDueDate, -3));
    await ctx.http
      .post('/v1/payments')
      .set(bearer(finance.token))
      .send({ agreementId: a.id, amountPaise: r(3000), method: 'CASH' })
      .expect(201);
    const res = await run(addDays(a.firstDueDate, -2));
    expect(res.body).toMatchObject({ chargesCancelled: 1 });
    expect(gateway.cancelledCharges).toHaveLength(1);
    const view = await staffView();
    expect(view.mandate.charges[0]).toMatchObject({
      status: 'CANCELLED',
      failureReason: 'Instalment already paid another way',
    });
  });

  it('leaves a failed charge to the usual reminders, and the driver can pay it in the app', async () => {
    await switchOn();
    await run(addDays(a.firstDueDate, -3));
    const charge = (await staffView()).mandate.charges[0];
    await ctx.http
      .post(`/v1/autopay/charges/${charge.id}/simulate`)
      .set(bearer(ops.token))
      .send({ status: 'FAILED' })
      .expect(200);
    ctx.clock.set(a.firstDueDate);
    const view = await mine();
    expect(view.dueByAutopay).toBe(false);
    expect(view.autopay.nextCharge).toBeNull();
    await ctx.http.post(`/v1/me/agreements/${a.id}/pay`).set(bearer(driver)).expect(200);
  });

  it('lets only head office switch AutoPay off once it is on; the driver may withdraw a request', async () => {
    await ctx.http
      .post(`/v1/me/agreements/${a.id}/autopay`)
      .set(bearer(driver))
      .send({})
      .expect(200);
    const withdrawn = await ctx.http
      .post(`/v1/me/agreements/${a.id}/autopay/cancel`)
      .set(bearer(driver))
      .expect(200);
    expect(withdrawn.body.autopay.status).toBe('OFF');

    await switchOn();
    await run(addDays(a.firstDueDate, -3));
    const locked = await ctx.http
      .post(`/v1/me/agreements/${a.id}/autopay/cancel`)
      .set(bearer(driver))
      .expect(403);
    expect(locked.body.code).toBe('AUTOPAY_LOCKED');
    expect((await staffView()).mandate.status).toBe('ACTIVE');

    await ctx.http
      .post(`/v1/agreements/${a.id}/autopay/cancel`)
      .set(bearer(ops.token))
      .send({ reason: 'Driver asked at the office' })
      .expect(200);
    expect(gateway.cancelledCharges).toHaveLength(1);
    expect([...gateway.mandates.values()].at(-1)!.status).toBe('CANCELLED');
    expect((await staffView()).mandate).toMatchObject({ status: 'CANCELLED', endedBy: 'STAFF' });
  });

  it('records a mandate the driver cancelled from their UPI app', async () => {
    await switchOn();
    const view = await staffView();
    await ctx.http
      .post(`/v1/autopay/mandates/${view.mandate.id}/simulate`)
      .set(bearer(ops.token))
      .send({ status: 'CUSTOMER_CANCELLED' })
      .expect(200);
    expect((await staffView()).mandate).toMatchObject({
      status: 'CANCELLED',
      endedBy: 'DRIVER_UPI',
    });
  });

  it("offers e-NACH on the bank account, taken and receipted as e-NACH, with the driver's email", async () => {
    const emails = ctx.app.get<MemoryEmailSender>(EMAIL_SENDER);
    emails.sent.length = 0;
    await ctx.http
      .patch('/v1/me')
      .set(bearer(driver))
      .send({ email: ' Ramesh.Das@Example.com ' })
      .expect(200);
    const before = await mine();
    expect(before.autopay.methods).toMatchObject({
      UPI: { available: true },
      ENACH: { available: true },
    });
    await switchOn('ENACH');
    const sub = [...gateway.mandates.values()].at(-1)!;
    expect(sub.input).toMatchObject({
      method: 'ENACH',
      customer: { email: 'ramesh.das@example.com' },
    });
    expect((await mine()).autopay).toMatchObject({ status: 'ACTIVE', method: 'ENACH' });
    await run(addDays(a.firstDueDate, -3));
    const charge = (await staffView()).mandate.charges[0];
    await ctx.http
      .post(`/v1/autopay/charges/${charge.id}/simulate`)
      .set(bearer(ops.token))
      .send({ status: 'SUCCESS' })
      .expect(200);
    const receipts = await ctx.http.get('/v1/me/payments').set(bearer(driver)).expect(200);
    expect(receipts.body[0]).toMatchObject({ amount: r(3000), method: 'ENACH' });
    // The receipt also went by email, with the PDF.
    const mail = emails.sent.at(-1)!;
    expect(mail.to).toBe('ramesh.das@example.com');
    expect(mail.attachment?.contentType).toBe('application/pdf');
    expect(mail.attachment?.content.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('does not let head office record e-NACH money by hand', async () => {
    await ctx.http
      .post('/v1/payments')
      .set(bearer(finance.token))
      .send({ agreementId: a.id, amountPaise: r(3000), method: 'ENACH' })
      .expect(400);
  });
});

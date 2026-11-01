import { addDays, rupeesToPaise as r } from '@voltneo/shared';
import {
  DRIVER_CODE_SENDER,
  type MemoryDriverCodeSender,
} from '../src/driver-auth/driver-code-sender';
import { bearer, createTestApp, loginAs, resetData, type TestContext } from './helpers';
import { activeAgreement, makeDriver } from './fixtures';

type Login = Awaited<ReturnType<typeof loginAs>>;

describe('Driver App (M6)', () => {
  let ctx: TestContext;
  let codes: MemoryDriverCodeSender;
  let pm: Login;
  let ops: Login;
  let finance: Login;
  let a: Awaited<ReturnType<typeof activeAgreement>>;

  beforeAll(async () => {
    ctx = await createTestApp();
    codes = ctx.app.get<MemoryDriverCodeSender>(DRIVER_CODE_SENDER);
  });
  beforeEach(async () => {
    ctx.clock.reset();
    await resetData(ctx.prisma);
    codes.sent.length = 0;
    pm = await loginAs(ctx, 'PLAN_MANAGER');
    ops = await loginAs(ctx, 'OPERATIONS_MANAGER');
    finance = await loginAs(ctx, 'FINANCE');
    a = await activeAgreement(ctx, { ops: ops.token, finance: finance.token, pm: pm.token });
  });
  afterEach(() => ctx.clock.reset());
  afterAll(async () => {
    await ctx.app.close();
  });

  async function signIn(phone: string) {
    await ctx.http.post('/v1/driver-auth/code/request').send({ phone }).expect(202);
    const code = codes.lastCodeFor(phone);
    if (!code) throw new Error(`no code for ${phone}`);
    const res = await ctx.http
      .post('/v1/driver-auth/code/verify')
      .send({ phone, code })
      .expect(200);
    return res.body as {
      session?: { accessToken: string; refreshToken: string; driver: { id: string } };
      choose?: { id: string; name: string }[];
      selectToken?: string;
    };
  }

  describe('signing in', () => {
    it('sends a code only to drivers with a signed agreement, and never says which numbers exist', async () => {
      await ctx.http.post('/v1/driver-auth/code/request').send({ phone: '9000000001' }).expect(202);
      const unsigned = await makeDriver(ctx, ops.token);
      codes.sent.length = 0; // the registration code sent while registering
      await ctx.http
        .post('/v1/driver-auth/code/request')
        .send({ phone: unsigned.phone })
        .expect(202);
      expect(codes.sent).toHaveLength(0);

      await ctx.http
        .post('/v1/driver-auth/code/request')
        .send({ phone: a.driverPhone })
        .expect(202);
      expect(codes.sent).toHaveLength(1);
      expect(codes.sent[0]).toMatchObject({ phone: a.driverPhone, language: 'BN' });
      await ctx.http
        .post('/v1/driver-auth/code/verify')
        .send({
          phone: a.driverPhone,
          code: '000000' === codes.sent[0]!.code ? '111111' : '000000',
        })
        .expect(401);
      const ok = await ctx.http
        .post('/v1/driver-auth/code/verify')
        .send({ phone: a.driverPhone, code: codes.sent[0]!.code })
        .expect(200);
      expect(ok.body.session.driver).toMatchObject({ language: 'BN' });
      // A code works once.
      await ctx.http
        .post('/v1/driver-auth/code/verify')
        .send({ phone: a.driverPhone, code: codes.sent[0]!.code })
        .expect(401);
    });

    it('keeps driver and staff sign-ins apart', async () => {
      const { session } = await signIn(a.driverPhone);
      await ctx.http.get('/v1/me').set(bearer(session!.accessToken)).expect(200);
      await ctx.http.get('/v1/me').set(bearer(ops.token)).expect(401);
      await ctx.http.get('/v1/agreements').set(bearer(session!.accessToken)).expect(401);
    });

    it('rotates refresh tokens, ends every session if an old one comes back, and signs out', async () => {
      const { session } = await signIn(a.driverPhone);
      const next = await ctx.http
        .post('/v1/driver-auth/refresh')
        .send({ refreshToken: session!.refreshToken })
        .expect(200);
      await ctx.http
        .post('/v1/driver-auth/refresh')
        .send({ refreshToken: session!.refreshToken })
        .expect(401);
      await ctx.http
        .post('/v1/driver-auth/refresh')
        .send({ refreshToken: next.body.refreshToken })
        .expect(401);
      await ctx.http.get('/v1/me').set(bearer(next.body.accessToken)).expect(401);

      const again = await signIn(a.driverPhone);
      await ctx.http
        .post('/v1/driver-auth/logout')
        .set(bearer(again.session!.accessToken))
        .expect(204);
      await ctx.http.get('/v1/me').set(bearer(again.session!.accessToken)).expect(401);
    });

    it('lets drivers who share a phone pick their name', async () => {
      const b = await activeAgreement(ctx, {
        ops: ops.token,
        finance: finance.token,
        pm: pm.token,
      });
      const bDriver = await ctx.prisma.agreement.findUniqueOrThrow({ where: { id: b.id } });
      await ctx.prisma.driver.update({
        where: { id: bDriver.driverId },
        data: { phone: a.driverPhone },
      });
      const res = await signIn(a.driverPhone);
      expect(res.session).toBeUndefined();
      expect(res.choose).toHaveLength(2);
      await ctx.http
        .post('/v1/driver-auth/select')
        .send({ selectToken: res.selectToken, driverId: a.id })
        .expect(401);
      const picked = await ctx.http
        .post('/v1/driver-auth/select')
        .send({ selectToken: res.selectToken, driverId: bDriver.driverId })
        .expect(200);
      const me = await ctx.http
        .get('/v1/me/agreement')
        .set(bearer(picked.body.accessToken))
        .expect(200);
      expect(me.body.number).toBe(b.number);
    });
  });

  describe('agreement, paying and receipts', () => {
    let token: string;
    beforeEach(async () => {
      token = (await signIn(a.driverPhone)).session!.accessToken;
    });

    it('shows the plan and what is due, and pays only the amount due', async () => {
      const view = await ctx.http.get('/v1/me/agreement').set(bearer(token)).expect(200);
      expect(view.body).toMatchObject({
        id: a.id,
        state: 'ACTIVE',
        money: { instalment: r(3000), paid: r(20000) },
        documents: { signedCopy: true },
      });
      expect(view.body.due).toMatchObject({ kind: 'NOT_YET', nextAmount: r(3000) });
      const early = await ctx.http
        .post(`/v1/me/agreements/${a.id}/pay`)
        .set(bearer(token))
        .expect(422);
      expect(early.body.code).toBe('NOTHING_DUE');

      ctx.clock.set(addDays(a.firstDueDate, -2));
      const due = await ctx.http.get('/v1/me/agreement').set(bearer(token)).expect(200);
      expect(due.body.due).toMatchObject({ kind: 'UPCOMING', amount: r(3000) });
      const pay = await ctx.http
        .post(`/v1/me/agreements/${a.id}/pay`)
        .set(bearer(token))
        .expect(200);
      expect(pay.body).toMatchObject({ amount: r(3000) });
      expect(pay.body.url).toMatch(/^https:\/\//);
      // Pressing Pay again gives the same open link.
      const again = await ctx.http
        .post(`/v1/me/agreements/${a.id}/pay`)
        .set(bearer(token))
        .expect(200);
      expect(again.body.url).toBe(pay.body.url);
      expect(ctx.messages.sent.filter((m) => m.template === 'payment_link')).toHaveLength(0);

      const link = await ctx.prisma.paymentLink.findFirstOrThrow({
        where: { agreementId: a.id, status: 'ACTIVE' },
      });
      expect(link.createdById).toBeNull();
      await ctx.http
        .post(`/v1/payment-links/${link.id}/simulate-paid`)
        .set(bearer(finance.token))
        .expect(200);
      const list = await ctx.http.get('/v1/me/payments').set(bearer(token)).expect(200);
      expect(list.body.map((p: { amount: number }) => p.amount)).toEqual([r(3000), r(20000)]);
      const receipt = await ctx.http
        .get(`/v1/me/payments/${list.body[0].id}/receipt`)
        .set(bearer(token))
        .buffer(true)
        .expect(200);
      expect(receipt.headers['content-type']).toContain('application/pdf');
      const after = await ctx.http.get('/v1/me/agreement').set(bearer(token)).expect(200);
      expect(after.body.due.kind).toBe('NOT_YET');
    });

    it('never shows another driver’s agreement or receipt', async () => {
      const b = await activeAgreement(ctx, {
        ops: ops.token,
        finance: finance.token,
        pm: pm.token,
      });
      await ctx.http.get(`/v1/me/agreement?id=${b.id}`).set(bearer(token)).expect(404);
      await ctx.http.post(`/v1/me/agreements/${b.id}/pay`).set(bearer(token)).expect(404);
      const theirs = await ctx.prisma.payment.findFirstOrThrow({ where: { agreementId: b.id } });
      await ctx.http.get(`/v1/me/payments/${theirs.id}/receipt`).set(bearer(token)).expect(404);
      await ctx.http.get(`/v1/me/agreements/${b.id}/key-facts`).set(bearer(token)).expect(404);
    });

    it('gives the Key Facts in the driver’s language and a link to the signed copy', async () => {
      const kf = await ctx.http
        .get(`/v1/me/agreements/${a.id}/key-facts`)
        .set(bearer(token))
        .buffer(true)
        .expect(200);
      expect(kf.headers['content-disposition']).toContain('schedule-5-bn.pdf');
      const copy = await ctx.http
        .get(`/v1/me/agreements/${a.id}/signed-copy`)
        .set(bearer(token))
        .expect(200);
      expect(copy.body.url).toMatch(/^\/v1\/files\//);
      await ctx.http.get(copy.body.url).expect(200);
    });

    it('changes the language', async () => {
      const res = await ctx.http
        .patch('/v1/me')
        .set(bearer(token))
        .send({ language: 'HI' })
        .expect(200);
      expect(res.body.driver.language).toBe('HI');
    });
  });

  describe('reporting a fault', () => {
    it('opens a service request from the app, one at a time per battery', async () => {
      const { session } = await signIn(a.driverPhone);
      const token = session!.accessToken;
      const res = await ctx.http
        .post('/v1/me/tickets')
        .set(bearer(token))
        .send({ agreementId: a.id, category: 'CHARGING', description: 'Does not charge fully' })
        .expect(201);
      expect(res.body).toHaveLength(1);
      expect(res.body[0]).toMatchObject({ category: 'CHARGING', status: 'OPEN' });
      const t = await ctx.prisma.serviceTicket.findFirstOrThrow({ where: { agreementId: a.id } });
      expect(t).toMatchObject({ channel: 'APP', createdById: null });
      expect(ctx.messages.sent.some((m) => m.template === 'ticket_received')).toBe(true);
      const again = await ctx.http
        .post('/v1/me/tickets')
        .set(bearer(token))
        .send({ agreementId: a.id, category: 'OTHER', description: 'Something else too' })
        .expect(409);
      expect(again.body.code).toBe('TICKET_OPEN');
      const staffView = await ctx.http
        .get(`/v1/tickets/${t.id}`)
        .set(bearer(ops.token))
        .expect(200);
      expect(staffView.body.channel).toBe('APP');
    });
  });
});

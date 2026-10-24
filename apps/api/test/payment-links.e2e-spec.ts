import { createHmac } from 'node:crypto';
import { rupeesToPaise as r } from '@voltneo/shared';
import { APP_CONFIG, loadConfig } from '../src/config/app-config';
import { CashfreeGateway, FakeGateway, PAYMENT_GATEWAY } from '../src/payments/gateway';
import { bearer, createTestApp, loginAs, resetData, type TestContext } from './helpers';
import { activeAgreement } from './fixtures';

type Login = Awaited<ReturnType<typeof loginAs>>;

describe('UPI payment links (M5)', () => {
  describe('with the pretend gateway', () => {
    let ctx: TestContext;
    let pm: Login;
    let ops: Login;
    let finance: Login;
    let agent: Login;
    let support: Login;
    let a: Awaited<ReturnType<typeof activeAgreement>>;

    beforeAll(async () => {
      ctx = await createTestApp();
    });
    beforeEach(async () => {
      await resetData(ctx.prisma);
      pm = await loginAs(ctx, 'PLAN_MANAGER');
      ops = await loginAs(ctx, 'OPERATIONS_MANAGER');
      finance = await loginAs(ctx, 'FINANCE');
      agent = await loginAs(ctx, 'FIELD_AGENT');
      support = await loginAs(ctx, 'SUPPORT');
      a = await activeAgreement(ctx, { ops: ops.token, finance: finance.token, pm: pm.token });
      ctx.messages.sent.length = 0;
    });
    afterAll(async () => {
      await ctx.app.close();
    });

    const send = (amount: number, token = agent.token) =>
      ctx.http
        .post(`/v1/agreements/${a.id}/payment-links`)
        .set(bearer(token))
        .send({ amountPaise: amount });

    it('sends a link by SMS, replaces an open one, and records the payment when paid', async () => {
      await send(r(1500), support.token).expect(403);
      const tooMuch = await send(r(54001)).expect(422);
      expect(tooMuch.body).toMatchObject({ code: 'OVERPAYMENT', outstanding: r(54000) });

      const first = (await send(r(1500)).expect(201)).body;
      expect(first.gateway).toBe('fake');
      expect(first.items).toHaveLength(1);
      expect(first.items[0]).toMatchObject({ amount: r(1500), status: 'ACTIVE' });
      const sms = ctx.messages.sent.at(-1)!;
      expect(sms.template).toBe('payment_link');
      expect(sms.body).toContain(first.items[0].url);
      expect(sms.body).toContain('₹1,500');

      // A second link replaces the first, so the driver has one to pay.
      const second = (await send(r(3000), finance.token).expect(201)).body;
      expect(second.items.map((l: { status: string }) => l.status)).toEqual([
        'ACTIVE',
        'CANCELLED',
      ]);
      const open = second.items[0];

      ctx.messages.sent.length = 0;
      const paid = await ctx.http
        .post(`/v1/payment-links/${open.id}/simulate-paid`)
        .set(bearer(finance.token))
        .expect(200);
      expect(paid.body.outcome.status).toBe('processed');
      expect(paid.body.links.items[0]).toMatchObject({ status: 'PAID' });
      const payment = await ctx.prisma.payment.findUniqueOrThrow({
        where: { id: paid.body.outcome.paymentId },
      });
      expect(payment).toMatchObject({ amount: r(3000), source: 'GATEWAY', provider: 'fake' });
      expect(ctx.messages.sent.at(-1)!.template).toBe('payment_receipt');

      // Final: no second payment, no resend.
      await ctx.http
        .post(`/v1/payment-links/${open.id}/simulate-paid`)
        .set(bearer(finance.token))
        .expect(409);
      await ctx.http
        .post(`/v1/payment-links/${open.id}/resend`)
        .set(bearer(agent.token))
        .expect(409);
      await expect(
        ctx.prisma.paymentLink.update({ where: { id: open.id }, data: { closedNote: 'x' } }),
      ).rejects.toThrow(/cannot be changed/);
    });

    it('resends and cancels an open link', async () => {
      const l = (await send(r(500)).expect(201)).body.items[0];
      ctx.messages.sent.length = 0;
      await ctx.http.post(`/v1/payment-links/${l.id}/resend`).set(bearer(agent.token)).expect(200);
      expect(ctx.messages.sent).toHaveLength(1);
      const cancelled = await ctx.http
        .post(`/v1/payment-links/${l.id}/cancel`)
        .set(bearer(agent.token))
        .expect(200);
      expect(cancelled.body.items[0]).toMatchObject({ status: 'CANCELLED' });
      const fake = ctx.app.get<FakeGateway>(PAYMENT_GATEWAY);
      expect(fake.cancelled).toContain(l.linkId);
    });

    it('does not take money on a finished agreement', async () => {
      await ctx.http
        .post(`/v1/agreements/${a.id}/early-exit`)
        .set(bearer(finance.token))
        .send({
          agreementId: a.id,
          amountPaise: r(54000),
          quotedTotalPaise: r(54000),
          method: 'CASH',
        })
        .expect(201);
      await send(r(100)).expect(409);
    });
  });

  describe('with Cashfree', () => {
    const SECRET = 'cf-test-secret-key-0123456789';
    let ctx: TestContext;
    let pm: Login;
    let ops: Login;
    let finance: Login;
    let a: Awaited<ReturnType<typeof activeAgreement>>;
    const calls: { url: string; init: RequestInit }[] = [];
    const fakeFetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const body = JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>;
      if (url.endsWith('/cancel'))
        return new Response('{"link_status":"CANCELLED"}', { status: 200 });
      return new Response(
        JSON.stringify({
          link_id: body.link_id,
          cf_link_id: 4455,
          link_url: `https://payments-test.cashfree.com/links/${String(body.link_id)}`,
          link_status: 'ACTIVE',
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    beforeAll(async () => {
      ctx = await createTestApp((b) =>
        b
          .overrideProvider(APP_CONFIG)
          .useFactory({
            factory: () => {
              // Same settings as the other tests, plus Cashfree.
              return loadConfig({
                ...process.env,
                PAYMENT_GATEWAY: 'cashfree',
                CASHFREE_APP_ID: 'TEST_APP_ID',
                CASHFREE_SECRET_KEY: SECRET,
                PUBLIC_API_URL: 'https://api.voltneo.test',
              });
            },
          })
          .overrideProvider(PAYMENT_GATEWAY)
          .useValue(
            new CashfreeGateway(
              { env: 'sandbox', appId: 'TEST_APP_ID', secretKey: SECRET, apiVersion: '2026-01-01' },
              'https://api.voltneo.test/v1/webhooks/payments/cashfree',
              fakeFetch,
            ),
          ),
      );
    });
    beforeEach(async () => {
      calls.length = 0;
      await resetData(ctx.prisma);
      pm = await loginAs(ctx, 'PLAN_MANAGER');
      ops = await loginAs(ctx, 'OPERATIONS_MANAGER');
      finance = await loginAs(ctx, 'FINANCE');
      a = await activeAgreement(ctx, { ops: ops.token, finance: finance.token, pm: pm.token });
    });
    afterAll(async () => {
      await ctx.app.close();
    });

    function webhook(payload: unknown, opts: { secret?: string; key?: string } = {}) {
      const raw = JSON.stringify(payload);
      const ts = String(Date.now());
      const sig = createHmac('sha256', opts.secret ?? SECRET)
        .update(ts + raw)
        .digest('base64');
      const req = ctx.http
        .post('/v1/webhooks/payments/cashfree')
        .set('content-type', 'application/json')
        .set('x-webhook-timestamp', ts)
        .set('x-webhook-signature', sig);
      if (opts.key) req.set('x-idempotency-key', opts.key);
      return req.send(raw);
    }

    it('creates a UPI-only link at Cashfree and records the payment from its signed webhook', async () => {
      const res = await ctx.http
        .post(`/v1/agreements/${a.id}/payment-links`)
        .set(bearer(finance.token))
        .send({ amountPaise: r(1500.5) })
        .expect(201);
      const link = res.body.items[0];
      expect(res.body.gateway).toBe('cashfree');
      expect(link.url).toMatch(/^https:\/\/payments-test\.cashfree\.com\/links\//);

      const call = calls[0]!;
      expect(call.url).toBe('https://sandbox.cashfree.com/pg/links');
      const headers = call.init.headers as Record<string, string>;
      expect(headers['x-client-id']).toBe('TEST_APP_ID');
      expect(headers['x-api-version']).toBe('2026-01-01');
      const sent = JSON.parse(String(call.init.body)) as {
        customer_details: { customer_phone: string };
        link_expiry_time: string;
      };
      expect(sent).toMatchObject({
        link_id: link.linkId,
        link_amount: 1500.5,
        link_currency: 'INR',
        link_partial_payments: false,
        link_notify: { send_sms: false, send_email: false },
        link_meta: {
          notify_url: 'https://api.voltneo.test/v1/webhooks/payments/cashfree',
          payment_methods: 'upi',
        },
      });
      expect(sent.customer_details.customer_phone).toMatch(/^\d{10}$/);
      expect(sent.link_expiry_time).toMatch(/\+05:30$/);

      const paid = {
        type: 'PAYMENT_LINK_EVENT',
        version: 1,
        event_time: new Date().toISOString(),
        data: {
          cf_link_id: 4455,
          link_id: link.linkId,
          link_status: 'PAID',
          link_amount: '1500.50',
          link_amount_paid: '1500.50',
          order: {
            order_amount: '1500.50',
            order_id: 'CFPay_abc',
            transaction_id: 1021206,
            transaction_status: 'SUCCESS',
          },
        },
      };
      await webhook(paid, { secret: 'wrong-secret' }).expect(401);
      const ok = await webhook(paid).expect(200);
      expect(ok.body.status).toBe('processed');
      const payment = await ctx.prisma.payment.findUniqueOrThrow({
        where: { id: ok.body.paymentId },
      });
      expect(payment).toMatchObject({
        amount: r(1500.5),
        method: 'UPI',
        provider: 'cashfree',
        providerRef: '1021206',
      });
      const saved = await ctx.prisma.paymentLink.findUniqueOrThrow({ where: { id: link.id } });
      expect(saved).toMatchObject({ status: 'PAID', paymentId: payment.id, gatewayRef: '4455' });

      // Cashfree retries: counted once.
      expect((await webhook(paid).expect(200)).body.status).toBe('duplicate');
      // Same payment under a different delivery ID: still one payment.
      expect((await webhook(paid, { key: 'other-delivery' }).expect(200)).body.status).toBe(
        'processed',
      );
      expect(await ctx.prisma.payment.count({ where: { provider: 'cashfree' } })).toBe(1);
    });

    it('marks a link expired when Cashfree says so, and parks unknown links for review', async () => {
      const res = await ctx.http
        .post(`/v1/agreements/${a.id}/payment-links`)
        .set(bearer(finance.token))
        .send({ amountPaise: r(800) })
        .expect(201);
      const link = res.body.items[0];
      await webhook({
        type: 'PAYMENT_LINK_EVENT',
        data: { cf_link_id: 4455, link_id: link.linkId, link_status: 'EXPIRED', order: null },
      }).expect(200);
      expect(
        (await ctx.prisma.paymentLink.findUniqueOrThrow({ where: { id: link.id } })).status,
      ).toBe('EXPIRED');

      const unknown = await webhook({
        type: 'PAYMENT_LINK_EVENT',
        data: {
          link_id: 'VNL_UNKNOWN',
          link_status: 'PAID',
          order: { order_amount: '10.00', transaction_id: 77, transaction_status: 'SUCCESS' },
        },
      }).expect(200);
      expect(unknown.body.status).toBe('needs_review');
      const other = await webhook({ type: 'PAYMENT_SUCCESS_WEBHOOK', data: {} }).expect(200);
      expect(other.body.status).toBe('ignored');
    });
  });
});

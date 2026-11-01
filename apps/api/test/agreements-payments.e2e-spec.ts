import { createHmac } from 'node:crypto';
import { addMonths, financialYear, rupeesToPaise as r, suggestFirstDueDate } from '@voltneo/shared';
import { istDate } from '../src/common/util';
import {
  bearer,
  createStaff,
  createTestApp,
  login,
  loginAs,
  resetData,
  type TestContext,
} from './helpers';
import {
  PDF,
  PNG,
  realPng,
  approvedDriver,
  makeBattery,
  makeBatteryType,
  makeDriver,
  publishedPlan,
  readyDriver,
} from './fixtures';

const WEBHOOK_SECRET = 'test-webhook-secret-test-webhook-secret-01';

describe('Agreements, installation and payments (modules 6-8)', () => {
  let ctx: TestContext;
  let pm: { token: string; staff: { id: string } };
  let ops: { token: string; staff: { id: string } };
  let ops2: { token: string; staff: { id: string } };
  let finance: { token: string; staff: { id: string } };
  let typeId: string;
  let versionId: string;
  let planId: string;
  const fy = () => financialYear(istDate());
  const firstDue = () => suggestFirstDueDate(17, istDate());

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  beforeEach(async () => {
    await resetData(ctx.prisma);
    ctx.messages.sent.length = 0;
    pm = await loginAs(ctx, 'PLAN_MANAGER');
    ops = await loginAs(ctx, 'OPERATIONS_MANAGER');
    ops2 = await loginAs(ctx, 'OPERATIONS_MANAGER');
    finance = await loginAs(ctx, 'FINANCE');
    typeId = (await makeBatteryType(ctx, pm.token, { purchase: 50000 })).id;
    const published = await publishedPlan(ctx, pm.token, typeId);
    versionId = published.versionId;
    planId = published.plan.id;
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  /** A driver with head office's final approval on the test plan (founder, 1 Nov 2026). */
  const approved = (overrides: Record<string, unknown> = {}) =>
    approvedDriver(ctx, ops.token, planId, overrides);

  /**
   * Head office assigns a battery (a new one in stock unless given) and the
   * agreement is prepared with it. Call .expect(status) as with a request.
   */
  function draft(driverId: string, overrides: Record<string, unknown> = {}) {
    const req = (async () => {
      const batteryId =
        (overrides.batteryId as string | undefined) ??
        (await makeBattery(ctx, ops.token, typeId)).id;
      // Wrapped so awaiting does not send the request before .expect is attached.
      return {
        test: ctx.http
          .post('/v1/agreements')
          .set(bearer(ops.token))
          .send({ driverId, dueDay: 17, firstDueDate: firstDue(), ...overrides, batteryId }),
      };
    })();
    return { expect: (status: number) => req.then((w) => w.test.expect(status)) };
  }

  async function signed(driverId?: string) {
    const d = driverId ?? (await approved()).id;
    const a = (await draft(d).expect(201)).body;
    const res = await ctx.http
      .post(`/v1/agreements/${a.id}/sign`)
      .set(bearer(ops.token))
      .field('signedAt', new Date().toISOString())
      .field('explainedInLanguage', 'BN')
      .field('stampPaperNumber', 'WB-NJ-123456')
      .field('stampValueRupees', '100')
      .field('stampPurchasedOn', '2026-10-01')
      .attach('files', PDF, 'signed.pdf')
      .expect(200);
    return res.body;
  }

  function pay(token: string, body: Record<string, unknown>) {
    return ctx.http.post('/v1/payments').set(bearer(token)).send(body);
  }

  async function installed() {
    const a = await signed();
    await pay(finance.token, { agreementId: a.id, amountPaise: r(20000), method: 'CASH' }).expect(
      201,
    );
    const tech = await createStaff(ctx.prisma, 'TECHNICIAN');
    const battery = a.battery as { id: string; serial: string };
    const res = await ctx.http
      .post(`/v1/agreements/${a.id}/installation`)
      .set(bearer(ops.token))
      .field('technicianId', tech.id)
      .field('installedAt', new Date().toISOString())
      .field('location', 'Driver home, Baruipur')
      .field('voltageReading', '52.4')
      .field('conditionNote', 'New battery, wiring checked')
      .field('driverConfirmed', 'true')
      .attach('photos', PNG, 'front.png')
      .attach('photos', PNG, 'wiring.png')
      .expect(200);
    return { agreement: res.body, battery, tech };
  }

  function signWebhook(body: string, secret = WEBHOOK_SECRET) {
    return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
  }

  function webhook(
    event: Record<string, unknown>,
    opts: { secret?: string; provider?: string } = {},
  ) {
    const body = JSON.stringify(event);
    return ctx.http
      .post(`/v1/webhooks/payments/${opts.provider ?? 'test'}`)
      .set('Content-Type', 'application/json')
      .set('X-VoltNeo-Signature', signWebhook(body, opts.secret))
      .send(body);
  }

  async function ledgerBalanced() {
    const res = await ctx.http.get('/v1/ledger/balances').set(bearer(finance.token)).expect(200);
    return res.body;
  }

  describe('drafts', () => {
    it('lists published plans with their prices for the new-agreement form', async () => {
      const res = await ctx.http.get('/v1/agreements/options').set(bearer(ops.token)).expect(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0]).toMatchObject({
        planVersionId: versionId,
        termMonths: 18,
        prices: [
          {
            batteryTypeId: typeId,
            downPayment: r(20000),
            instalment: r(3000),
            totalPayable: r(74000),
          },
        ],
      });
    });

    it('copies the figures from the price grid and shows the schedule it will get', async () => {
      const d = await approved();
      const res = await draft(d.id).expect(201);
      expect(res.body).toMatchObject({
        number: 'NOA-000001',
        state: 'DRAFT',
        language: 'BN',
        documentVersion: 'NO-AGR-DRAFT-1',
        terms: {
          downPayment: r(20000),
          instalment: r(3000),
          termMonths: 18,
          totalPayable: r(74000),
          dueDay: 17,
          firstDueDate: firstDue(),
          lastDueDate: addMonths(firstDue(), 17),
          graceDays: 5,
          lateFeePerDayPaise: r(100),
          lateFeeCapDays: 30,
        },
        money: { paid: 0, outstanding: r(74000) },
        allowed: { edit: true, sign: true, cancel: true, install: false, pay: false },
      });
      expect(res.body.schedule).toHaveLength(19);
      expect(res.body.readiness.ready).toBe(true);
      expect(res.body.events[0]).toMatchObject({ event: 'CREATED', toState: 'DRAFT' });
      expect(res.body.battery).toMatchObject({ serial: expect.any(String), status: 'IN_STOCK' });
      expect(res.body.battery.gpsDeviceId).toMatch(/^\d{15}$/);
      expect(res.body.plan.planVersionId).toBe(versionId);
    });

    it('is prepared only for an approved driver, on their approved plan, with a battery that is free', async () => {
      // Founder, 1 Nov 2026: final approval, then a battery, then the agreement.
      const waiting = await readyDriver(ctx, ops.token, { planId });
      expect((await draft(waiting.id).expect(422)).body.code).toBe('NOT_APPROVED');

      const d = await approved();
      const noImei = await makeBattery(ctx, ops.token, typeId, { gps: false });
      expect((await draft(d.id, { batteryId: noImei.id }).expect(422)).body.message).toMatch(
        /IMEI/,
      );
      const unpriced = await makeBattery(ctx, ops.token, (await makeBatteryType(ctx, pm.token)).id);
      expect((await draft(d.id, { batteryId: unpriced.id }).expect(422)).body.message).toMatch(
        /no price/,
      );
      const battery = await makeBattery(ctx, ops.token, typeId);
      const a = (await draft(d.id, { batteryId: battery.id }).expect(201)).body;

      // The battery is held: not offered to anyone else, and not moved out of stock.
      const other = await approved();
      expect((await draft(other.id, { batteryId: battery.id }).expect(409)).body.message).toMatch(
        new RegExp(`assigned to agreement ${a.number}`),
      );
      const free = await ctx.http
        .get(`/v1/batteries?available=true&limit=100`)
        .set(bearer(ops.token))
        .expect(200);
      expect(free.body.items.map((b: { id: string }) => b.id)).not.toContain(battery.id);
      const shown = await ctx.http
        .get(`/v1/batteries/${battery.id}`)
        .set(bearer(ops.token))
        .expect(200);
      expect(shown.body.assignedTo).toMatchObject({ agreementId: a.id, number: a.number });
      await ctx.http
        .post(`/v1/batteries/${battery.id}/status`)
        .set(bearer(ops.token))
        .send({ to: 'UNDER_REPAIR', note: 'Check cells' })
        .expect(409);
    });

    it('changes the battery until installation; after signing the driver signs again first', async () => {
      const a = await signed();
      await pay(finance.token, { agreementId: a.id, amountPaise: r(20000), method: 'CASH' }).expect(
        201,
      );
      const otherType = (await makeBatteryType(ctx, pm.token)).id;
      const wrongType = await makeBattery(ctx, ops.token, otherType);
      const change = (batteryId: string, token = ops.token) =>
        ctx.http
          .post(`/v1/agreements/${a.id}/battery`)
          .set(bearer(token))
          .send({ batteryId, reason: 'Found a cell fault before fitting' });
      expect((await change(wrongType.id).expect(422)).body.message).toMatch(/same type/);
      const agent = await loginAs(ctx, 'FIELD_AGENT');
      const replacement = await makeBattery(ctx, ops.token, typeId);
      await change(replacement.id, agent.token).expect(403);
      const changed = (await change(replacement.id).expect(200)).body;
      expect(changed).toMatchObject({
        battery: { id: replacement.id },
        resignRequired: true,
        allowed: { install: false, resign: true },
        terms: { downPayment: r(20000), instalment: r(3000) },
      });
      expect(changed.batteryChanges[0]).toMatchObject({
        fromSerial: a.battery.serial,
        toSerial: replacement.serial,
        afterSigning: true,
        resigned: null,
      });
      // The old battery is free again.
      const old = await ctx.http
        .get(`/v1/batteries/${a.battery.id}`)
        .set(bearer(ops.token))
        .expect(200);
      expect(old.body.assignedTo).toBeNull();

      const tech = await createStaff(ctx.prisma, 'TECHNICIAN');
      const install = () =>
        ctx.http
          .post(`/v1/agreements/${a.id}/installation`)
          .set(bearer(ops.token))
          .field('technicianId', tech.id)
          .field('installedAt', new Date().toISOString())
          .field('location', 'Baruipur')
          .field('voltageReading', '52.4')
          .field('conditionNote', 'Good')
          .field('driverConfirmed', 'true')
          .attach('photos', PNG, 'p.png');
      expect((await install().expect(409)).body.message).toMatch(/corrected agreement/);

      const resigned = await ctx.http
        .post(`/v1/agreements/${a.id}/resign`)
        .set(bearer(ops.token))
        .field('signedAt', new Date().toISOString())
        .attach('files', PDF, 'corrected.pdf')
        .expect(200);
      expect(resigned.body).toMatchObject({ resignRequired: false, allowed: { install: true } });
      expect(resigned.body.batteryChanges[0].resigned).toMatchObject({
        recordedByName: expect.any(String),
      });
      const link = await ctx.http
        .post(`/v1/agreements/${a.id}/signed-copy/link`)
        .set(bearer(ops.token))
        .expect(200);
      expect(link.body.url).toBeTruthy();

      const done = await install().expect(200);
      expect(done.body).toMatchObject({ state: 'ACTIVE', battery: { id: replacement.id } });
      expect((await change(a.battery.id).expect(409)).body.message).toMatch(
        /before it is installed/,
      );
    });

    it('checks the due day, the first due date and the vehicle type', async () => {
      const d = await approved();
      const wrongDay = addMonths(firstDue(), 0).replace(/-17$/, '-18');
      expect((await draft(d.id, { firstDueDate: wrongDay }).expect(422)).body.message).toMatch(
        /17th/,
      );
      expect((await draft(d.id, { dueDay: 5 }).expect(400)).body.message.join()).toMatch(/dueDay/);
      const soon = istDate();
      await draft(d.id, { firstDueDate: soon }).expect(422);

      const scooterType = await ctx.prisma.batteryType.update({
        where: { id: typeId },
        data: { compatibleVehicles: ['E_THREE_WHEELER'] },
      });
      expect(scooterType.compatibleVehicles).toEqual(['E_THREE_WHEELER']);
      expect((await draft(d.id).expect(422)).body.message).toMatch(/vehicle type/);
    });

    it('allows one open agreement per driver', async () => {
      const d = await approved();
      await draft(d.id).expect(201);
      expect((await draft(d.id).expect(409)).body.message).toMatch(/already has an open agreement/);
    });

    it('lets head office edit a draft, and support only read', async () => {
      const d = await approved();
      const a = (await draft(d.id).expect(201)).body;
      const res = await ctx.http
        .patch(`/v1/agreements/${a.id}`)
        .set(bearer(ops.token))
        .send({ dueDay: 2, firstDueDate: suggestFirstDueDate(2, istDate()) })
        .expect(200);
      expect(res.body.terms).toMatchObject({
        dueDay: 2,
        firstDueDate: suggestFirstDueDate(2, istDate()),
      });

      const support = await loginAs(ctx, 'SUPPORT');
      await ctx.http.get(`/v1/agreements/${a.id}`).set(bearer(support.token)).expect(200);
      await ctx.http
        .patch(`/v1/agreements/${a.id}`)
        .set(bearer(support.token))
        .send({ notes: 'x' })
        .expect(403);
      await ctx.http.post('/v1/agreements').set(bearer(support.token)).send({}).expect(403);
    });

    it('produces Schedule 1 and Schedule 5 as PDFs in each language', async () => {
      const d = await approved();
      const a = (await draft(d.id).expect(201)).body;
      for (const doc of ['schedule-1', 'schedule-5']) {
        for (const lang of ['BN', 'HI', 'EN', undefined]) {
          const res = await ctx.http
            .get(`/v1/agreements/${a.id}/documents/${doc}${lang ? `?lang=${lang}` : ''}`)
            .set(bearer(ops.token))
            .buffer(true)
            .parse((resp, cb) => {
              const chunks: Buffer[] = [];
              resp.on('data', (c: Buffer) => chunks.push(c));
              resp.on('end', () => cb(null, Buffer.concat(chunks)));
            })
            .expect(200);
          expect(res.headers['content-type']).toBe('application/pdf');
          expect(res.headers['content-disposition']).toContain(
            `NOA-000001-${doc}-${(lang ?? 'BN').toLowerCase()}.pdf`,
          );
          expect((res.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
          expect((res.body as Buffer).length).toBeGreaterThan(5000);
        }
      }
      await ctx.http
        .get(`/v1/agreements/${a.id}/documents/schedule-9`)
        .set(bearer(ops.token))
        .expect(404);
    });

    it('cancels a draft with a reason', async () => {
      const d = await approved();
      const a = (await draft(d.id).expect(201)).body;
      const res = await ctx.http
        .post(`/v1/agreements/${a.id}/cancel`)
        .set(bearer(ops.token))
        .send({ reason: 'Driver changed his mind' })
        .expect(200);
      expect(res.body).toMatchObject({
        state: 'CANCELLED',
        cancelReason: 'Driver changed his mind',
      });
      // The driver can start again.
      await draft(d.id).expect(201);
    });
  });

  describe('signing', () => {
    it('refuses to sign if the checklist is no longer complete', async () => {
      const d = await approved();
      const a = (await draft(d.id).expect(201)).body;
      // A document found wrong after approval.
      const pan = await ctx.prisma.kycDocument.findFirstOrThrow({
        where: { driverId: d.id, type: 'PAN' },
      });
      await ctx.http
        .post(`/v1/kyc-documents/${pan.id}/reject`)
        .set(bearer(ops.token))
        .send({ reason: 'Photo is not readable' })
        .expect(200);
      const res = await ctx.http
        .post(`/v1/agreements/${a.id}/sign`)
        .set(bearer(ops.token))
        .field('signedAt', new Date().toISOString())
        .field('explainedInLanguage', 'BN')
        .field('stampPaperNumber', 'WB-NJ-123456')
        .field('stampValueRupees', '100')
        .field('stampPurchasedOn', '2026-10-01')
        .attach('files', PDF, 'signed.pdf')
        .expect(422);
      expect(res.body.code).toBe('NOT_READY');
    });

    it('records the signed copy, creates the payment table and freezes the terms', async () => {
      const a = await signed();
      expect(a).toMatchObject({
        state: 'AWAITING_DOWN_PAYMENT',
        signed: { method: 'PAPER', fileName: 'signed.pdf', explainedInLanguage: 'BN' },
        allowed: { edit: false, sign: false, pay: true, cancel: true, reschedule: true },
      });
      expect(a.signed.explainedByName).toBeTruthy();
      expect(a.schedule).toHaveLength(19);
      expect(a.schedule[0]).toMatchObject({
        sequence: 0,
        dueDate: null,
        amount: r(20000),
        status: 'UNPAID',
      });
      expect(a.schedule[18]).toMatchObject({ sequence: 18, dueDate: addMonths(firstDue(), 17) });

      await ctx.http
        .patch(`/v1/agreements/${a.id}`)
        .set(bearer(ops.token))
        .send({ notes: 'x' })
        .expect(409);
      await expect(
        ctx.prisma.$executeRawUnsafe(
          `UPDATE "agreements" SET "instalment" = 1 WHERE id = '${a.id}'`,
        ),
      ).rejects.toThrow(/cannot be changed/);
      await expect(
        ctx.prisma.$executeRawUnsafe(
          `UPDATE "instalments" SET "amount" = 1 WHERE "agreement_id" = '${a.id}'`,
        ),
      ).rejects.toThrow(/cannot be changed/);

      const link = await ctx.http
        .post(`/v1/agreements/${a.id}/signed-copy/link`)
        .set(bearer(ops.token))
        .expect(200);
      const file = await ctx.http.get(link.body.url).expect(200);
      expect(file.headers['content-type']).toContain('application/pdf');
    });

    it('joins page photos into one PDF and records the stamp paper, which then cannot change', async () => {
      const d = await approved();
      const a = (await draft(d.id).expect(201)).body;
      const sign = () =>
        ctx.http
          .post(`/v1/agreements/${a.id}/sign`)
          .set(bearer(ops.token))
          .field('signedAt', new Date().toISOString())
          .field('explainedInLanguage', 'HI')
          .field('stampPaperNumber', 'WB-NJ-778899')
          .field('stampValueRupees', '50');
      // Stamp paper bought after signing, or a PDF mixed with photos: refused.
      await sign()
        .field('stampPurchasedOn', '2099-01-01')
        .attach('files', realPng(), 'p1.png')
        .expect(400);
      const mixed = await sign()
        .field('stampPurchasedOn', '2026-10-01')
        .attach('files', PDF, 'scan.pdf')
        .attach('files', realPng(), 'p1.png')
        .expect(400);
      expect(mixed.body.message).toMatch(/one PDF, or photos/);

      const res = await sign()
        .field('stampPurchasedOn', '2026-10-01')
        .attach('files', realPng(), 'page1.png')
        .attach('files', realPng(60, 80), 'page2.png')
        .attach('files', realPng(), 'page3.png')
        .expect(200);
      expect(res.body.signed).toMatchObject({
        fileName: `${a.number}-signed.pdf`,
        stamp: { number: 'WB-NJ-778899', value: r(50), purchasedOn: '2026-10-01' },
      });
      const link = await ctx.http
        .post(`/v1/agreements/${a.id}/signed-copy/link`)
        .set(bearer(ops.token))
        .expect(200);
      const file = await ctx.http.get(link.body.url).buffer(true).expect(200);
      const pdf = Buffer.from(file.body as Buffer).toString('latin1');
      expect(pdf.startsWith('%PDF-')).toBe(true);
      expect(pdf.match(/\/Type \/Page\b/g)).toHaveLength(3);

      await expect(
        ctx.prisma.agreement.update({ where: { id: a.id }, data: { stampPaperNumber: 'X-1' } }),
      ).rejects.toThrow(/cannot be changed/);
    });

    it('prints the whole agreement for stamp paper, with the company and the driver named', async () => {
      const d = await approved();
      const a = (await draft(d.id).expect(201)).body;
      const res = await ctx.http
        .get(`/v1/agreements/${a.id}/documents/agreement`)
        .set(bearer(ops.token))
        .buffer(true)
        .expect(200);
      expect(res.headers['content-type']).toContain('application/pdf');
      expect(res.headers['content-disposition']).toContain(`${a.number}-agreement.pdf`);
      const pdf = Buffer.from(res.body as Buffer).toString('latin1');
      expect((pdf.match(/\/Type \/Page\b/g) ?? []).length).toBeGreaterThan(8);
      await ctx.http
        .get(`/v1/agreements/${a.id}/documents/nonsense`)
        .set(bearer(ops.token))
        .expect(404);
    });

    it('prints the full PAN only for staff who may see full ID numbers, and logs it', async () => {
      const d = await approved();
      const a = (await draft(d.id).expect(201)).body;
      const reveals = () =>
        ctx.prisma.auditLog.count({
          where: { action: 'kyc.number_revealed', after: { path: ['driverId'], equals: d.id } },
        });
      const support = await loginAs(ctx, 'SUPPORT');
      await ctx.http
        .get(`/v1/agreements/${a.id}/documents/agreement`)
        .set(bearer(support.token))
        .buffer(true)
        .expect(200);
      expect(await reveals()).toBe(0);
      await ctx.http
        .get(`/v1/agreements/${a.id}/documents/agreement`)
        .set(bearer(ops.token))
        .buffer(true)
        .expect(200);
      expect(await reveals()).toBe(1);
      const log = await ctx.prisma.auditLog.findFirstOrThrow({
        where: { action: 'kyc.number_revealed', actorId: ops.staff.id },
        orderBy: { at: 'desc' },
      });
      expect(log.after).toMatchObject({ type: 'PAN', purpose: 'agreement_print' });
    });

    it('cancels a signed agreement only while no money has been received', async () => {
      const a = await signed();
      await pay(finance.token, { agreementId: a.id, amountPaise: r(500), method: 'CASH' }).expect(
        201,
      );
      await ctx.http
        .post(`/v1/agreements/${a.id}/cancel`)
        .set(bearer(ops.token))
        .send({ reason: 'Changed mind' })
        .expect(409);
    });
  });

  describe('down payment and installation', () => {
    it('takes the down payment in parts and then waits for installation', async () => {
      const a = await signed();
      const over = await pay(finance.token, {
        agreementId: a.id,
        amountPaise: r(20001),
        method: 'CASH',
      }).expect(422);
      expect(over.body).toMatchObject({ code: 'OVERPAYMENT', outstanding: r(20000) });

      const first = await pay(finance.token, {
        agreementId: a.id,
        amountPaise: r(5000),
        method: 'CASH',
      }).expect(201);
      expect(first.body).toMatchObject({
        receiptNumber: `VNR/${fy()}/000001`,
        amount: r(5000),
        balanceAfter: r(69000),
        collectedByName: expect.any(String),
        allocations: [{ kind: 'DOWN_PAYMENT', amount: r(5000) }],
        agreement: { state: 'AWAITING_DOWN_PAYMENT' },
      });
      const second = await pay(finance.token, {
        agreementId: a.id,
        amountPaise: r(15000),
        method: 'UPI',
        reference: 'utr123456789',
      }).expect(201);
      expect(second.body).toMatchObject({
        receiptNumber: `VNR/${fy()}/000002`,
        reference: 'UTR123456789',
        agreement: { state: 'AWAITING_INSTALLATION' },
      });

      // The driver gets an SMS receipt in their language (test mode: kept in memory).
      expect(ctx.messages.sent).toHaveLength(2);
      expect(ctx.messages.sent[1]!.body).toContain(`VNR/${fy()}/000002`);
      expect(ctx.messages.sent[1]!.body).toContain('চুক্তি');
      expect(second.body.messages[0]).toMatchObject({ channel: 'SMS', status: 'SENT' });

      // No instalments before installation.
      await pay(finance.token, { agreementId: a.id, amountPaise: r(3000), method: 'CASH' }).expect(
        409,
      );
      expect((await ledgerBalanced()).balanced).toBe(true);
    });

    it('installs only the battery assigned in the agreement, with photos', async () => {
      const a = await signed();
      const tech = await createStaff(ctx.prisma, 'TECHNICIAN');
      const battery = a.battery as { id: string; serial: string };
      const install = (fields: Record<string, string>, photos = 1) => {
        const req = ctx.http.post(`/v1/agreements/${a.id}/installation`).set(bearer(ops.token));
        const all = {
          batteryId: battery.id,
          technicianId: tech.id,
          installedAt: new Date().toISOString(),
          location: 'Baruipur',
          voltageReading: '52.4',
          conditionNote: 'Good',
          driverConfirmed: 'true',
          ...fields,
        };
        for (const [k, v] of Object.entries(all)) req.field(k, v);
        for (let i = 0; i < photos; i++) req.attach('photos', PNG, `p${i}.png`);
        return req;
      };
      // Down payment first (clause C2).
      expect((await install({}).expect(409)).body.message).toMatch(/down payment/);
      await pay(finance.token, { agreementId: a.id, amountPaise: r(20000), method: 'CASH' }).expect(
        201,
      );

      await install({}, 0).expect(400);
      await install({ driverConfirmed: 'false' }).expect(400);
      await install({ technicianId: finance.staff.id }).expect(400);
      const another = await makeBattery(ctx, ops.token, typeId);
      expect((await install({ batteryId: another.id }).expect(422)).body.message).toMatch(
        new RegExp(`Fit battery ${battery.serial}`),
      );

      const res = await install({}, 2).expect(200);
      expect(res.body).toMatchObject({
        state: 'ACTIVE',
        battery: { id: battery.id, serial: battery.serial },
        installation: { voltageReading: '52.4', driverConfirmed: true, location: 'Baruipur' },
      });
      expect(res.body.installation.photos).toHaveLength(2);
      expect(res.body.installation.technicianName).toBe(tech.name);

      const b = await ctx.http
        .get(`/v1/batteries/${battery.id}`)
        .set(bearer(ops.token))
        .expect(200);
      expect(b.body).toMatchObject({ status: 'INSTALLED', holder: 'DRIVER' });
      expect(b.body.custody.at(-1) ?? b.body.custody[0]).toBeTruthy();
      const custody = await ctx.prisma.batteryCustody.findMany({
        where: { batteryId: battery.id },
      });
      expect(custody.map((c) => c.event)).toContain('INSTALLED');

      const photo = await ctx.http
        .post(
          `/v1/agreements/${a.id}/installation/photos/${res.body.installation.photos[0].id}/link`,
        )
        .set(bearer(ops.token))
        .expect(200);
      await ctx.http.get(photo.body.url).expect(200);

      // The same battery cannot be assigned to a second agreement.
      const again = await draft((await approved()).id, { batteryId: battery.id }).expect(409);
      expect(again.body.message).toMatch(/not in stock/);
    });
  });

  describe('instalments', () => {
    it('pays late fees first, then the oldest instalment, and accepts part-payments (B5, B10)', async () => {
      const { agreement: a } = await installed();
      const inst = await ctx.prisma.instalment.findFirstOrThrow({
        where: { agreementId: a.id, sequence: 1 },
      });
      await ctx.prisma.lateFeeAccrual.create({
        data: {
          agreementId: a.id,
          instalmentId: inst.id,
          accrualDate: new Date('2026-12-23'),
          amount: r(100),
        },
      });

      const res = await pay(finance.token, {
        agreementId: a.id,
        amountPaise: r(4000),
        method: 'UPI',
        reference: 'UTR-1001',
      }).expect(201);
      expect(res.body.allocations).toEqual([
        expect.objectContaining({ kind: 'LATE_FEE', amount: r(100), lateFeeDate: '2026-12-23' }),
        expect.objectContaining({ kind: 'INSTALMENT', amount: r(3000), sequence: 1 }),
        expect.objectContaining({ kind: 'INSTALMENT', amount: r(900), sequence: 2 }),
      ]);
      expect(res.body.balanceAfter).toBe(r(74000 - 20000 - 3900));

      const view = await ctx.http.get(`/v1/agreements/${a.id}`).set(bearer(ops.token)).expect(200);
      expect(view.body.schedule[1]).toMatchObject({ sequence: 1, status: 'PAID' });
      expect(view.body.schedule[2]).toMatchObject({
        sequence: 2,
        status: 'PART_PAID',
        amountPaid: r(900),
      });
      expect(view.body.money).toMatchObject({
        paid: r(23900),
        outstanding: r(50100),
        lateFeesDue: 0,
        instalmentsPaid: 1,
        nextDue: { sequence: 2, amountLeft: r(2100) },
      });

      // The same UPI reference cannot be entered twice.
      await pay(finance.token, {
        agreementId: a.id,
        amountPaise: r(100),
        method: 'UPI',
        reference: 'utr-1001',
      }).expect(409);
      // UPI and card need a reference.
      await pay(finance.token, { agreementId: a.id, amountPaise: r(100), method: 'CARD' }).expect(
        400,
      );
      expect((await ledgerBalanced()).balanced).toBe(true);
    });

    it('counts a repeated request with the same ID only once', async () => {
      const { agreement: a } = await installed();
      const body = {
        agreementId: a.id,
        amountPaise: r(3000),
        method: 'CASH',
        clientRequestId: 'device-req-0001',
      };
      const one = await pay(finance.token, body).expect(201);
      const two = await pay(finance.token, body).expect(201);
      expect(two.body).toMatchObject({ id: one.body.id, repeated: true });
      await pay(finance.token, { ...body, amountPaise: r(2000) }).expect(409);
      expect(await ctx.prisma.payment.count({ where: { agreementId: a.id } })).toBe(2);
    });

    it('lets agents record only their own cash, and support nothing', async () => {
      const { agreement: a } = await installed();
      const agent = await loginAs(ctx, 'FIELD_AGENT');
      const other = await createStaff(ctx.prisma, 'FIELD_AGENT');
      // Field agents use the Field App; the API rule is what matters here.
      await pay(agent.token, {
        agreementId: a.id,
        amountPaise: r(100),
        method: 'UPI',
        reference: 'UTR-77',
      }).expect(403);
      await pay(agent.token, {
        agreementId: a.id,
        amountPaise: r(100),
        method: 'CASH',
        collectedById: other.id,
      }).expect(403);
      const own = await pay(agent.token, {
        agreementId: a.id,
        amountPaise: r(100),
        method: 'CASH',
      }).expect(201);
      expect(own.body.collectedById).toBe(agent.staff.id);

      // Finance can record cash handed over by a named agent, but not by a technician.
      const tech = await createStaff(ctx.prisma, 'TECHNICIAN');
      await pay(finance.token, {
        agreementId: a.id,
        amountPaise: r(100),
        method: 'CASH',
        collectedById: tech.id,
      }).expect(400);
      await pay(finance.token, {
        agreementId: a.id,
        amountPaise: r(100),
        method: 'CASH',
        collectedById: other.id,
      }).expect(201);

      const support = await loginAs(ctx, 'SUPPORT');
      await pay(support.token, { agreementId: a.id, amountPaise: r(100), method: 'CASH' }).expect(
        403,
      );
      await ctx.http.get(`/v1/agreements/${a.id}/payments`).set(bearer(support.token)).expect(200);
    });

    it('finishes early when everything is paid ahead (E7)', async () => {
      const { agreement: a } = await installed();
      await pay(finance.token, { agreementId: a.id, amountPaise: r(54001), method: 'CASH' }).expect(
        422,
      );
      const res = await pay(finance.token, {
        agreementId: a.id,
        amountPaise: r(54000),
        method: 'CASH',
      }).expect(201);
      expect(res.body).toMatchObject({ balanceAfter: 0, agreement: { state: 'EARLY_EXIT' } });
      const view = await ctx.http.get(`/v1/agreements/${a.id}`).set(bearer(ops.token)).expect(200);
      expect(view.body.completedAt).toBeTruthy();
      expect(view.body.events.map((e: { event: string }) => e.event)).toEqual([
        'CREATED',
        'SIGNED',
        'DOWN_PAYMENT_RECEIVED',
        'INSTALLED',
        'EARLY_EXIT',
      ]);
      await pay(finance.token, { agreementId: a.id, amountPaise: r(1), method: 'CASH' }).expect(
        409,
      );
    });

    it('produces a receipt PDF and can resend the receipt message after a failure', async () => {
      const { agreement: a } = await installed();
      ctx.messages.failNext = true;
      const p = await pay(finance.token, {
        agreementId: a.id,
        amountPaise: r(3000),
        method: 'CASH',
      }).expect(201);
      expect(p.body.messages[0]).toMatchObject({
        status: 'FAILED',
        error: 'Simulated provider failure',
      });

      const resent = await ctx.http
        .post(`/v1/payments/${p.body.id}/resend-receipt`)
        .set(bearer(finance.token))
        .expect(200);
      expect(resent.body.messages.map((m: { status: string }) => m.status)).toEqual([
        'FAILED',
        'SENT',
      ]);

      for (const lang of ['', '?lang=HI', '?lang=EN']) {
        const pdf = await ctx.http
          .get(`/v1/payments/${p.body.id}/receipt${lang}`)
          .set(bearer(finance.token))
          .buffer(true)
          .parse((resp, cb) => {
            const chunks: Buffer[] = [];
            resp.on('data', (c: Buffer) => chunks.push(c));
            resp.on('end', () => cb(null, Buffer.concat(chunks)));
          })
          .expect(200);
        expect(pdf.headers['content-type']).toBe('application/pdf');
        expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
      }
    });

    it('keeps money records append-only and every journal balanced', async () => {
      const { agreement: a } = await installed();
      const p = await pay(finance.token, {
        agreementId: a.id,
        amountPaise: r(3000),
        method: 'CASH',
      }).expect(201);
      await expect(
        ctx.prisma.$executeRawUnsafe(
          `UPDATE "payments" SET "amount" = 1 WHERE id = '${p.body.id}'`,
        ),
      ).rejects.toThrow(/append-only/);
      await expect(ctx.prisma.$executeRawUnsafe(`DELETE FROM "ledger_entries"`)).rejects.toThrow(
        /append-only/,
      );
      await expect(
        ctx.prisma.$transaction(async (tx) => {
          const j = await tx.ledgerJournal.create({ data: { kind: 'TEST', memo: 'unbalanced' } });
          await tx.ledgerEntry.createMany({
            data: [
              { journalId: j.id, account: 'BANK', debit: 100 },
              { journalId: j.id, account: 'INSTALMENTS_RECEIVED', credit: 99 },
            ],
          });
        }),
      ).rejects.toThrow(/does not balance/);
      const list = await ctx.http.get('/v1/payments').set(bearer(finance.token)).expect(200);
      expect(list.body).toMatchObject({ total: 2, totalAmount: r(23000) });
    });
  });

  describe('cash deposits', () => {
    it('tracks cash per agent through deposit and a second person’s bank check', async () => {
      const { agreement: a } = await installed();
      const agent = await loginAs(ctx, 'FIELD_AGENT');
      await pay(agent.token, { agreementId: a.id, amountPaise: r(3000), method: 'CASH' }).expect(
        201,
      );

      let holdings = (
        await ctx.http.get('/v1/cash/holdings').set(bearer(finance.token)).expect(200)
      ).body;
      expect(holdings.find((h: { agentId: string }) => h.agentId === agent.staff.id)).toMatchObject(
        {
          collected: r(3000),
          held: r(3000),
          awaitingCheck: 0,
        },
      );

      const deposit = (body: Record<string, unknown>, token = agent.token) =>
        ctx.http
          .post('/v1/cash/deposits')
          .set(bearer(token))
          .send({
            amountPaise: r(3000),
            bankReference: 'SBI-SLIP-001',
            depositedAt: new Date().toISOString(),
            ...body,
          });
      expect((await deposit({ amountPaise: r(3001) }).expect(422)).body.message).toMatch(
        /more than/,
      );
      await deposit({ agentId: finance.staff.id }).expect(403);
      const d = (await deposit({}).expect(201)).body;
      expect(d).toMatchObject({
        status: 'PENDING',
        agentName: agent.staff.name ?? expect.any(String),
      });

      holdings = (await ctx.http.get('/v1/cash/holdings').set(bearer(finance.token)).expect(200))
        .body;
      expect(holdings.find((h: { agentId: string }) => h.agentId === agent.staff.id)).toMatchObject(
        {
          held: 0,
          awaitingCheck: r(3000),
        },
      );

      // The agent cannot check their own deposit; agents only see their own deposits.
      await ctx.http
        .post(`/v1/cash/deposits/${d.id}/reconcile`)
        .set(bearer(agent.token))
        .send({})
        .expect(403);
      const mine = await ctx.http.get('/v1/cash/deposits').set(bearer(agent.token)).expect(200);
      expect(mine.body.total).toBe(1);

      const ok = await ctx.http
        .post(`/v1/cash/deposits/${d.id}/reconcile`)
        .set(bearer(finance.token))
        .send({ note: 'Seen on statement' })
        .expect(200);
      expect(ok.body).toMatchObject({ status: 'RECONCILED', reconciledByName: expect.any(String) });
      await ctx.http
        .post(`/v1/cash/deposits/${d.id}/reconcile`)
        .set(bearer(finance.token))
        .send({})
        .expect(409);

      const ledger = await ledgerBalanced();
      expect(ledger.balanced).toBe(true);
      const acc = Object.fromEntries(
        ledger.accounts.map((x: { account: string; net: number }) => [x.account, x.net]),
      );
      // Finance's earlier cash (down payment) is still with finance; the agent's ₹3,000 reached the bank.
      expect(acc.CASH_IN_TRANSIT).toBe(0);
      expect(acc.BANK).toBe(r(3000));
      expect(acc.CASH_WITH_AGENTS).toBe(r(20000));
      expect(acc.DOWN_PAYMENTS_RECEIVED).toBe(-r(20000));
      expect(acc.INSTALMENTS_RECEIVED).toBe(-r(3000));
    });

    it('stops the person who recorded a deposit from checking it', async () => {
      const { agreement: a } = await installed();
      const agent = await createStaff(ctx.prisma, 'FIELD_AGENT');
      await pay(finance.token, {
        agreementId: a.id,
        amountPaise: r(1000),
        method: 'CASH',
        collectedById: agent.id,
      }).expect(201);
      const d = await ctx.http
        .post('/v1/cash/deposits')
        .set(bearer(finance.token))
        .send({
          agentId: agent.id,
          amountPaise: r(1000),
          bankReference: 'SLIP-9',
          depositedAt: new Date().toISOString(),
        })
        .expect(201);
      await ctx.http
        .post(`/v1/cash/deposits/${d.body.id}/reconcile`)
        .set(bearer(finance.token))
        .send({})
        .expect(403);
      const finance2 = await loginAs(ctx, 'FINANCE');
      await ctx.http
        .post(`/v1/cash/deposits/${d.body.id}/reconcile`)
        .set(bearer(finance2.token))
        .send({})
        .expect(200);
    });
  });

  describe('payment webhooks', () => {
    const event = (number: string, extra: Record<string, unknown> = {}) => ({
      eventId: 'evt_1',
      type: 'payment.succeeded',
      agreementNumber: number,
      amountPaise: r(3000),
      method: 'UPI',
      providerRef: 'pay_ABC1',
      paidAt: new Date().toISOString(),
      ...extra,
    });

    it('checks the signature and records each event once', async () => {
      const { agreement: a } = await installed();
      await webhook(event(a.number), { secret: 'wrong-secret-wrong-secret-wrong-secret' }).expect(
        401,
      );
      await webhook(event(a.number), { provider: 'cashfree' }).expect(404);
      await ctx.http
        .post('/v1/webhooks/payments/test')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify(event(a.number)))
        .expect(401);

      const ok = await webhook(event(a.number)).expect(200);
      expect(ok.body).toMatchObject({ status: 'processed', paymentId: expect.any(String) });
      expect((await webhook(event(a.number)).expect(200)).body).toEqual({ status: 'duplicate' });
      // A different event for the same provider payment does not pay twice.
      const again = await webhook(event(a.number, { eventId: 'evt_2' })).expect(200);
      expect(again.body).toMatchObject({ status: 'processed', paymentId: ok.body.paymentId });

      const p = await ctx.http
        .get(`/v1/payments/${ok.body.paymentId}`)
        .set(bearer(finance.token))
        .expect(200);
      expect(p.body).toMatchObject({
        source: 'GATEWAY',
        provider: 'test',
        providerRef: 'pay_ABC1',
        method: 'UPI',
      });
      expect(await ctx.prisma.payment.count({ where: { agreementId: a.id } })).toBe(2);
    });

    it('parks events it cannot apply for review, and keeps overpayments as driver credit', async () => {
      const unknown = await webhook(event('NOA-999999', { eventId: 'evt_x' })).expect(200);
      expect(unknown.body).toMatchObject({
        status: 'needs_review',
        note: 'No agreement NOA-999999',
      });
      const parked = await ctx.prisma.webhookEvent.findFirstOrThrow({
        where: { eventId: 'evt_x' },
      });
      expect(parked.status).toBe('NEEDS_REVIEW');

      const a = await signed();
      const res = await webhook(
        event(a.number, { eventId: 'evt_y', providerRef: 'pay_Y', amountPaise: r(20500) }),
      ).expect(200);
      const p = await ctx.http
        .get(`/v1/payments/${res.body.paymentId}`)
        .set(bearer(finance.token))
        .expect(200);
      expect(p.body).toMatchObject({
        excess: r(500),
        agreement: { state: 'AWAITING_INSTALLATION' },
        allocations: [
          { kind: 'DOWN_PAYMENT', amount: r(20000) },
          { kind: 'EXCESS', amount: r(500) },
        ],
      });
      const acc = Object.fromEntries(
        (await ledgerBalanced()).accounts.map((x: { account: string; net: number }) => [
          x.account,
          x.net,
        ]),
      );
      expect(acc.GATEWAY_CLEARING).toBe(r(20500));
      expect(acc.DRIVER_CREDIT).toBe(-r(500));
    });
  });

  describe('moving the first due date (variation)', () => {
    it('needs a second head-office person and shifts every instalment', async () => {
      const a = await signed();
      const target = addMonths(firstDue(), 1);
      await ctx.http
        .post(`/v1/agreements/${a.id}/reschedule`)
        .set(bearer(ops.token))
        .send({ firstDueDate: addMonths(firstDue(), 3), reason: 'Too far' })
        .expect(422);
      const req = await ctx.http
        .post(`/v1/agreements/${a.id}/reschedule`)
        .set(bearer(ops.token))
        .send({ firstDueDate: target, reason: 'Installation delayed by rain' })
        .expect(201);
      expect(req.body).toMatchObject({ type: 'VARIATION', status: 'PENDING' });
      await ctx.http
        .post(`/v1/approval-requests/${req.body.id}/approve`)
        .set(bearer(ops.token))
        .send({})
        .expect(403);
      await ctx.http
        .post(`/v1/approval-requests/${req.body.id}/approve`)
        .set(bearer(ops2.token))
        .send({})
        .expect(200);
      const view = await ctx.http.get(`/v1/agreements/${a.id}`).set(bearer(ops.token)).expect(200);
      expect(view.body).toMatchObject({
        scheduleRevision: 2,
        terms: { firstDueDate: target, lastDueDate: addMonths(target, 17) },
      });
      expect(view.body.schedule[1].dueDate).toBe(target);
      expect(view.body.events.at(-1)).toMatchObject({ event: 'FIRST_DUE_DATE_MOVED' });
    });
  });

  it('lets the bootstrap super admin do everything through one login', async () => {
    const admin = await createStaff(ctx.prisma, 'SUPER_ADMIN');
    const session = await login(ctx, admin.email!);
    await ctx.http.get('/v1/agreements').set(bearer(session.accessToken)).expect(200);
    await ctx.http.get('/v1/ledger/balances').set(bearer(session.accessToken)).expect(200);
    const dir = await ctx.http.get('/v1/staff/directory').set(bearer(ops.token)).expect(200);
    expect(dir.body[0]).toEqual({
      id: expect.any(String),
      name: expect.any(String),
      role: expect.any(String),
    });
    expect(dir.body.some((s: { id: string }) => s.id === admin.id)).toBe(true);
  });
});

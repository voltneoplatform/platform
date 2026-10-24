import { addDays, addMonths, rupeesToPaise as r } from '@voltneo/shared';
import {
  bearer,
  createStaff,
  createTestApp,
  loginAs,
  resetData,
  type TestContext,
} from './helpers';
import { PNG, activeAgreement } from './fixtures';

describe('Collections: reminders, grace, late fee, immobilisation, restore, recovery (M3)', () => {
  let ctx: TestContext;
  let pm: { token: string; staff: { id: string } };
  let ops: { token: string; staff: { id: string } };
  let ops2: { token: string; staff: { id: string } };
  let finance: { token: string; staff: { id: string } };
  let a: Awaited<ReturnType<typeof activeAgreement>>;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  beforeEach(async () => {
    ctx.clock.reset();
    await resetData(ctx.prisma);
    ctx.messages.sent.length = 0;
    pm = await loginAs(ctx, 'PLAN_MANAGER');
    ops = await loginAs(ctx, 'OPERATIONS_MANAGER');
    ops2 = await loginAs(ctx, 'OPERATIONS_MANAGER');
    finance = await loginAs(ctx, 'FINANCE');
    a = await activeAgreement(ctx, { ops: ops.token, finance: finance.token, pm: pm.token });
    ctx.messages.sent.length = 0;
  });

  afterEach(() => ctx.clock.reset());

  afterAll(async () => {
    await ctx.app.close();
  });

  /** Moves the clock to `offset` days after the first due date and runs the jobs. */
  async function day(offset: number) {
    const date = addDays(a.firstDueDate, offset);
    ctx.clock.set(date);
    await ctx.http.post('/v1/collections/run').set(bearer(ops.token)).send({}).expect(200);
    return date;
  }

  const view = async () =>
    (await ctx.http.get(`/v1/agreements/${a.id}/collections`).set(bearer(ops.token)).expect(200))
      .body;
  const agreement = async () =>
    (await ctx.http.get(`/v1/agreements/${a.id}`).set(bearer(ops.token)).expect(200)).body;
  const pay = (amount: number) =>
    ctx.http
      .post('/v1/payments')
      .set(bearer(finance.token))
      .send({ agreementId: a.id, amountPaise: amount, method: 'CASH' });
  const smsBodies = () => ctx.messages.sent.map((m) => m.body);

  async function disable(at?: string) {
    const req = await ctx.http
      .post(`/v1/agreements/${a.id}/immobilisation-request`)
      .set(bearer(ops.token))
      .send({ reason: 'Final notice given; no payment' })
      .expect(201);
    await ctx.http
      .post(`/v1/approval-requests/${req.body.id}/approve`)
      .set(bearer(ops2.token))
      .send({})
      .expect(200);
    return ctx.http
      .post(`/v1/agreements/${a.id}/immobilisation`)
      .set(bearer(ops.token))
      .send({
        action: 'DISABLE',
        performedAt: at ?? ctx.clock.now().toISOString(),
        portalReference: 'GPSPORTAL-7781',
        vehicleStationaryConfirmed: true,
      });
  }

  it('sends reminders 5, 3 and 1 day before the due date and on it, once each (D41)', async () => {
    for (const d of [-6, -5, -4, -3, -2, -1, 0]) await day(d);
    await day(0); // a second run on the same day sends nothing new
    const reminders = ctx.messages.sent.filter((m) => m.template.startsWith('reminder'));
    expect(reminders.map((m) => m.template)).toEqual([
      'reminder_5',
      'reminder_3',
      'reminder_1',
      'reminder_0',
    ]);
    expect(reminders[0]!.body).toContain('₹3,000');
    expect(reminders[0]!.body).toContain(a.number);
    expect(reminders[3]!.body).toContain('আজ'); // "today", in the driver's language (Bengali)
  });

  it('skips reminders for an instalment already paid ahead', async () => {
    await pay(r(3000)).expect(201);
    ctx.messages.sent.length = 0;
    for (const d of [-5, -3, -1, 0]) await day(d);
    expect(ctx.messages.sent.filter((m) => m.template.startsWith('reminder'))).toHaveLength(0);
  });

  it('runs grace, final notice, two-person immobilisation, late fee and restore', async () => {
    // Day 1: in grace.
    await day(1);
    expect((await agreement()).state).toBe('IN_GRACE');
    let v = await view();
    expect(v).toMatchObject({
      stage: 'GRACE',
      daysOverdue: 1,
      overdueAmount: r(3000),
      lateFeesDue: 0,
    });
    // Too early to ask for immobilisation.
    await ctx.http
      .post(`/v1/agreements/${a.id}/immobilisation-request`)
      .set(bearer(ops.token))
      .send({ reason: 'Too early' })
      .expect(409);

    // Day 5: final notice, request allowed, approval not yet.
    for (const d of [2, 3, 4, 5]) await day(d);
    v = await view();
    expect(v.stage).toBe('FINAL_NOTICE');
    const finalNotices = ctx.messages.sent.filter((m) => m.template === 'final_notice');
    expect(finalNotices).toHaveLength(1);
    expect(finalNotices[0]!.body).toContain('₹3,000');
    const req = await ctx.http
      .post(`/v1/agreements/${a.id}/immobilisation-request`)
      .set(bearer(ops.token))
      .send({ reason: 'No payment after final notice' })
      .expect(201);
    await ctx.http
      .post(`/v1/approval-requests/${req.body.id}/approve`)
      .set(bearer(ops.token))
      .send({})
      .expect(403);
    const early = await ctx.http
      .post(`/v1/approval-requests/${req.body.id}/approve`)
      .set(bearer(ops2.token))
      .send({})
      .expect(409);
    expect(early.body.message).toMatch(/approved from/);

    // Day 6: late fee starts; the second person approves; staff record the disable.
    await day(6);
    v = await view();
    expect(v).toMatchObject({
      stage: 'IMMOBILISATION_REQUESTED',
      lateFeesDue: r(100),
      lateFeeDaysInSpell: 1,
    });
    await ctx.http
      .post(`/v1/approval-requests/${req.body.id}/approve`)
      .set(bearer(ops2.token))
      .send({})
      .expect(200);
    expect((await view()).stage).toBe('AWAITING_DISABLE');
    await ctx.http
      .post(`/v1/agreements/${a.id}/immobilisation`)
      .set(bearer(ops.token))
      .send({
        action: 'DISABLE',
        performedAt: ctx.clock.now().toISOString(),
        portalReference: 'P-1',
      })
      .expect(400); // the stationary check is mandatory
    const disabled = await ctx.http
      .post(`/v1/agreements/${a.id}/immobilisation`)
      .set(bearer(ops.token))
      .send({
        action: 'DISABLE',
        performedAt: ctx.clock.now().toISOString(),
        portalReference: 'GPSPORTAL-7781',
        vehicleStationaryConfirmed: true,
      })
      .expect(200);
    expect(disabled.body).toMatchObject({
      stage: 'IMMOBILISED',
      log: [{ action: 'DISABLE', portalReference: 'GPSPORTAL-7781' }],
    });
    expect((await agreement()).state).toBe('IMMOBILISED');
    expect(smsBodies().some((b) => b.includes('₹3,100'))).toBe(true); // instalment + day-6 fee

    // Day 7: one more fee, never twice for a day.
    await day(7);
    await day(7);
    expect((await view()).lateFeesDue).toBe(r(200));

    // A part payment goes to late fees first and does not clear the overdue.
    const part = await pay(r(3000)).expect(201);
    expect(part.body.allocations[0]).toMatchObject({ kind: 'LATE_FEE', amount: r(100) });
    expect((await view()).stage).toBe('IMMOBILISED');

    // Paying the rest clears it: restore is due, the late spell ends.
    await pay(r(200)).expect(201);
    v = await view();
    expect(v).toMatchObject({ stage: 'RESTORE_DUE', spellStartedOn: null, toClear: 0 });
    expect(v.allowed.recordRestore).toBe(true);
    const queue = await ctx.http.get('/v1/collections/queue').set(bearer(ops.token)).expect(200);
    expect(queue.body.items[0]).toMatchObject({ number: a.number, stage: 'RESTORE_DUE' });

    const restored = await ctx.http
      .post(`/v1/agreements/${a.id}/immobilisation`)
      .set(bearer(ops.token))
      .send({
        action: 'RESTORE',
        performedAt: ctx.clock.now().toISOString(),
        portalReference: 'GPSPORTAL-7790',
      })
      .expect(200);
    expect(restored.body.stage).toBeNull();
    const ag = await agreement();
    expect(ag.state).toBe('ACTIVE');
    expect(ag.events.map((e: { event: string }) => e.event)).toEqual(
      expect.arrayContaining(['GRACE_STARTED', 'IMMOBILISED', 'RESTORE_DUE', 'RESTORED']),
    );
    expect(ctx.messages.sent.at(-1)!.template).toBe('restored');
  });

  it('caps the late fee at 30 days per late spell, ₹100 a day however many instalments are overdue (D38)', async () => {
    for (let d = 1; d <= 45; d++) await day(d);
    let v = await view();
    // Two instalments are overdue by day 45, but the fee never stacks.
    expect(v.overdueAmount).toBe(r(6000));
    expect(v).toMatchObject({ lateFeesDue: r(3000), lateFeeDaysInSpell: 30, lateFeeCapDays: 30 });
    const accruals = await ctx.prisma.lateFeeAccrual.findMany({ where: { agreementId: a.id } });
    expect(accruals).toHaveLength(30);
    expect(new Set(accruals.map((f) => f.amount))).toEqual(new Set([r(100)]));

    // Clearing everything ends the spell; the next missed due date starts a new one.
    await pay(r(9000)).expect(201);
    v = await view();
    expect(v).toMatchObject({ spellStartedOn: null, toClear: 0, stage: null });
    expect((await agreement()).state).toBe('ACTIVE');

    const third = addMonths(a.firstDueDate, 2);
    for (let d = 1; d <= 7; d++) {
      ctx.clock.set(addDays(third, d));
      await ctx.http.post('/v1/collections/run').set(bearer(ops.token)).send({}).expect(200);
    }
    v = await view();
    expect(v).toMatchObject({ spellStartedOn: third, lateFeeDaysInSpell: 2, lateFeesDue: r(200) });
  });

  it('cancels an open immobilisation request when the driver pays', async () => {
    for (const d of [1, 5]) await day(d);
    const req = await ctx.http
      .post(`/v1/agreements/${a.id}/immobilisation-request`)
      .set(bearer(ops.token))
      .send({ reason: 'No payment' })
      .expect(201);
    await pay(r(3000)).expect(201);
    const after = await ctx.prisma.approvalRequest.findUniqueOrThrow({
      where: { id: req.body.id },
    });
    expect(after).toMatchObject({
      status: 'CANCELLED',
      decisionNote: expect.stringMatching(/paid/),
    });
    expect((await agreement()).state).toBe('ACTIVE');
  });

  it('recovers the battery 30 days after it was disabled, writes off dues and closes (D39, D45)', async () => {
    for (const d of [1, 5, 6]) await day(d);
    await disable().then((res) => expect(res.status).toBe(200));
    const disabledOn = addDays(a.firstDueDate, 6);

    ctx.clock.set(addDays(disabledOn, 29));
    await ctx.http
      .post(`/v1/agreements/${a.id}/recovery-request`)
      .set(bearer(ops.token))
      .send({ reason: 'Still unpaid' })
      .expect(409);

    for (let d = 7; d <= 36; d++) await day(d);
    expect((await view()).stage).toBe('DUE_FOR_RECOVERY');
    const req = await ctx.http
      .post(`/v1/agreements/${a.id}/recovery-request`)
      .set(bearer(ops.token))
      .send({ reason: 'Unpaid 30 days after disable' })
      .expect(201);
    await ctx.http
      .post(`/v1/approval-requests/${req.body.id}/approve`)
      .set(bearer(ops2.token))
      .send({})
      .expect(200);
    expect((await view()).stage).toBe('AWAITING_COLLECTION');

    const recoveryStaff = await loginAs(ctx, 'RECOVERY');
    const record = (batteryId: string) =>
      ctx.http
        .post(`/v1/agreements/${a.id}/recovery`)
        .set(bearer(recoveryStaff.token))
        .field('batteryId', batteryId)
        .field('recoveredById', recoveryStaff.staff.id)
        .field('recoveredAt', ctx.clock.now().toISOString())
        .field('location', 'Driver home, Baruipur')
        .field('conditionNote', 'Battery and GPS module intact')
        .attach('photos', PNG, 'collected.png');
    await record('00000000-0000-4000-8000-000000000000').expect(422);
    const done = await record(a.battery.id).expect(200);
    expect(done.body.recovery).toMatchObject({
      location: 'Driver home, Baruipur',
      writtenOffAmount: r(54000),
      writtenOffLateFees: r(3000), // day 6 to day 35: 30 days, the cap
    });

    const ag = await agreement();
    expect(ag.state).toBe('CLOSED');
    expect(ag.events.slice(-2).map((e: { event: string }) => e.event)).toEqual([
      'RECOVERED',
      'CLOSED',
    ]);
    const battery = await ctx.http
      .get(`/v1/batteries/${a.battery.id}`)
      .set(bearer(ops.token))
      .expect(200);
    expect(battery.body).toMatchObject({ status: 'RECOVERED', holder: 'RECOVERED' });

    // The account is closed: no more fees, no more payments (D45).
    await day(37);
    expect(await ctx.prisma.lateFeeAccrual.count({ where: { agreementId: a.id } })).toBe(30);
    await pay(r(100)).expect(409);
  });

  it('switches a battery back on without payment only with a reason, leaving it overdue', async () => {
    for (const d of [1, 5, 6]) await day(d);
    await disable().then((res) => expect(res.status).toBe(200));
    const send = (note?: string) =>
      ctx.http.post(`/v1/agreements/${a.id}/immobilisation`).set(bearer(ops.token)).send({
        action: 'RESTORE',
        performedAt: ctx.clock.now().toISOString(),
        portalReference: 'P-9',
        note,
      });
    await send().expect(400);
    const res = await send('Medical emergency: driver taking a patient to hospital').expect(200);
    expect(res.body.stage).toBe('DUE_FOR_IMMOBILISATION');
    expect((await agreement()).state).toBe('IN_GRACE');
  });

  it('catches up missed days, never runs a day twice, and keeps roles apart', async () => {
    await day(1);
    ctx.clock.set(addDays(a.firstDueDate, 9));
    const run = await ctx.http
      .post('/v1/collections/run')
      .set(bearer(ops.token))
      .send({})
      .expect(200);
    expect(
      run.body.daily
        .filter((d: { summary: unknown }) => d.summary)
        .map((d: { date: string }) => d.date),
    ).toEqual([2, 3, 4, 5, 6, 7, 8, 9].map((d) => addDays(a.firstDueDate, d)).slice(-7));
    const again = await ctx.http
      .post('/v1/collections/run')
      .set(bearer(ops.token))
      .send({})
      .expect(200);
    expect(again.body.daily.every((d: { summary: unknown }) => d.summary === null)).toBe(true);
    // Days 6-9 each charged once (day 2 was outside the 7-day catch-up window).
    expect((await view()).lateFeeDaysInSpell).toBe(4);

    const support = await loginAs(ctx, 'SUPPORT');
    await ctx.http.get('/v1/collections/queue').set(bearer(support.token)).expect(403);
    await ctx.http.get('/v1/collections/queue').set(bearer(finance.token)).expect(200);
    await ctx.http
      .post(`/v1/agreements/${a.id}/immobilisation-request`)
      .set(bearer(finance.token))
      .send({ reason: 'x'.repeat(5) })
      .expect(403);
    await ctx.http.post('/v1/collections/run').set(bearer(finance.token)).send({}).expect(403);
    const tech = await createStaff(ctx.prisma, 'TECHNICIAN');
    expect(tech.role).toBe('TECHNICIAN');
  });
});

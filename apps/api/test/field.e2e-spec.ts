import { addDays, rupeesToPaise as r } from '@voltneo/shared';
import {
  bearer,
  createStaff,
  createTestApp,
  login,
  loginAs,
  resetData,
  type TestContext,
} from './helpers';
import { PNG, activeAgreement } from './fixtures';

type Login = Awaited<ReturnType<typeof loginAs>>;

describe('Field App support (M5)', () => {
  let ctx: TestContext;
  let pm: Login;
  let ops: Login;
  let ops2: Login;
  let finance: Login;
  let a: Awaited<ReturnType<typeof activeAgreement>>;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  beforeEach(async () => {
    ctx.clock.reset();
    await resetData(ctx.prisma);
    pm = await loginAs(ctx, 'PLAN_MANAGER');
    ops = await loginAs(ctx, 'OPERATIONS_MANAGER');
    ops2 = await loginAs(ctx, 'OPERATIONS_MANAGER');
    finance = await loginAs(ctx, 'FINANCE');
    a = await activeAgreement(ctx, { ops: ops.token, finance: finance.token, pm: pm.token });
  });
  afterEach(() => ctx.clock.reset());
  afterAll(async () => {
    await ctx.app.close();
  });

  it('signs field staff in on the app only, with a longer pause allowed than the admin panel', async () => {
    const agent = await createStaff(ctx.prisma, 'FIELD_AGENT');
    await ctx.http.post('/v1/auth/otp/request').send({ identifier: agent.email }).expect(202);
    await expect(login(ctx, agent.email!, { web: true })).rejects.toThrow();
    const app = await login(ctx, agent.email!);
    expect(app.refreshToken).toBeTruthy();

    // An hour without use: the app session continues (ASSUMED 4 hours), the web one would not.
    await ctx.prisma.staffSession.updateMany({
      where: { staffId: agent.id },
      data: { lastUsedAt: new Date(Date.now() - 60 * 60_000) },
    });
    const renewed = await ctx.http
      .post('/v1/auth/refresh')
      .send({ refreshToken: app.refreshToken })
      .expect(200);
    expect(renewed.body.staff.role).toBe('FIELD_AGENT');

    // Five hours without use ends an app session too.
    const other = await login(ctx, ops.staff.email!);
    await ctx.prisma.staffSession.updateMany({
      where: { staffId: ops.staff.id },
      data: { lastUsedAt: new Date(Date.now() - 5 * 60 * 60_000) },
    });
    await ctx.http.post('/v1/auth/refresh').send({ refreshToken: other.refreshToken }).expect(401);
  });

  it('lets a field agent record an installation as the installer (founder, 31 Oct 2026)', async () => {
    const agent = await loginAs(ctx, 'FIELD_AGENT');
    const b = await activeAgreement(
      ctx,
      { ops: ops.token, finance: finance.token, pm: pm.token },
      { installAs: { token: agent.token, staffId: agent.staff.id } },
    );
    const view = await ctx.http.get(`/v1/agreements/${b.id}`).set(bearer(ops.token)).expect(200);
    expect(view.body.state).toBe('ACTIVE');
    const s = (await ctx.http.get('/v1/field/summary').set(bearer(agent.token)).expect(200)).body;
    expect(s.installationsWaiting).toBe(0);
  });

  it("shows a field agent their cash: what they hold and today's collections", async () => {
    const agent = await loginAs(ctx, 'FIELD_AGENT');
    const tech = await loginAs(ctx, 'TECHNICIAN');
    await ctx.http
      .post('/v1/payments')
      .set(bearer(agent.token))
      .send({ agreementId: a.id, amountPaise: r(1200), method: 'CASH' })
      .expect(201);
    const s = (await ctx.http.get('/v1/field/summary').set(bearer(agent.token)).expect(200)).body;
    expect(s.cash).toMatchObject({
      held: r(1200),
      awaitingCheck: 0,
      collectedToday: r(1200),
      paymentsToday: 1,
    });
    expect(s.myOpenTickets).toBeNull();
    const cash = (await ctx.http.get('/v1/field/cash').set(bearer(agent.token)).expect(200)).body;
    expect(cash.payments).toHaveLength(1);
    expect(cash.payments[0]).toMatchObject({ amount: r(1200), agreement: { number: a.number } });
    await ctx.http.get('/v1/field/cash').set(bearer(tech.token)).expect(403);
    // Head office uses the admin panel, not the Field App summary.
    await ctx.http.get('/v1/field/summary').set(bearer(finance.token)).expect(403);
  });

  it('counts a technician’s open and missed tickets', async () => {
    const tech = await loginAs(ctx, 'TECHNICIAN');
    const support = await loginAs(ctx, 'SUPPORT');
    await ctx.http
      .post('/v1/tickets')
      .set(bearer(support.token))
      .send({
        agreementId: a.id,
        category: 'CHARGING',
        channel: 'PHONE',
        description: 'Charger light stays red',
        reportedAt: new Date(Date.now() - 50 * 3_600_000 + 3_600_000).toISOString(),
        technicianId: tech.staff.id,
      })
      .expect(400); // before installation (the fixture installs today)
    await ctx.http
      .post('/v1/tickets')
      .set(bearer(support.token))
      .send({
        agreementId: a.id,
        category: 'CHARGING',
        channel: 'PHONE',
        description: 'Charger light stays red',
        technicianId: tech.staff.id,
      })
      .expect(201);
    ctx.clock.set(new Date(Date.now() + 49 * 3_600_000));
    const s = (await ctx.http.get('/v1/field/summary').set(bearer(tech.token)).expect(200)).body;
    expect(s).toMatchObject({ myOpenTickets: 1, myMissedTickets: 1, cash: null });
    expect(s.installationsWaiting).toBe(0);
  });

  it('lists approved recoveries for the recovery team, with where to find the driver', async () => {
    const recovery = await loginAs(ctx, 'RECOVERY');
    ctx.clock.set(addDays(a.firstDueDate, 6));
    await ctx.http.post('/v1/collections/run').set(bearer(ops.token)).send({}).expect(200);
    const imm = await ctx.http
      .post(`/v1/agreements/${a.id}/immobilisation-request`)
      .set(bearer(ops.token))
      .send({ reason: 'No payment' })
      .expect(201);
    await ctx.http
      .post(`/v1/approval-requests/${imm.body.id}/approve`)
      .set(bearer(ops2.token))
      .send({})
      .expect(200);
    await ctx.http
      .post(`/v1/agreements/${a.id}/immobilisation`)
      .set(bearer(ops.token))
      .send({
        action: 'DISABLE',
        performedAt: ctx.clock.now().toISOString(),
        portalReference: 'P-1',
        vehicleStationaryConfirmed: true,
      })
      .expect(200);
    ctx.clock.set(addDays(a.firstDueDate, 36));
    const rec = await ctx.http
      .post(`/v1/agreements/${a.id}/recovery-request`)
      .set(bearer(ops.token))
      .send({ reason: 'Unpaid 30 days after disable' })
      .expect(201);
    expect(
      (await ctx.http.get('/v1/field/recoveries').set(bearer(recovery.token)).expect(200)).body,
    ).toEqual([]);
    await ctx.http
      .post(`/v1/approval-requests/${rec.body.id}/approve`)
      .set(bearer(ops2.token))
      .send({})
      .expect(200);

    const jobs = (
      await ctx.http.get('/v1/field/recoveries').set(bearer(recovery.token)).expect(200)
    ).body;
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      number: a.number,
      battery: { serial: a.battery.serial },
      driver: { phone: a.driverPhone, address: expect.stringContaining('Station Road') },
    });
    const s = (await ctx.http.get('/v1/field/summary').set(bearer(recovery.token)).expect(200))
      .body;
    expect(s.recoveryJobs).toBe(1);

    await ctx.http
      .post(`/v1/agreements/${a.id}/recovery`)
      .set(bearer(recovery.token))
      .field('batteryId', a.battery.id)
      .field('recoveredById', recovery.staff.id)
      .field('recoveredAt', ctx.clock.now().toISOString())
      .field('location', 'Driver home')
      .field('conditionNote', 'Intact')
      .attach('photos', PNG, 'p.png')
      .expect(200);
    expect(
      (await ctx.http.get('/v1/field/recoveries').set(bearer(recovery.token)).expect(200)).body,
    ).toEqual([]);
    await ctx.http.get('/v1/field/recoveries').set(bearer(ops.token)).expect(200);
    const agent = await loginAs(ctx, 'FIELD_AGENT');
    await ctx.http.get('/v1/field/recoveries').set(bearer(agent.token)).expect(403);
  });
});

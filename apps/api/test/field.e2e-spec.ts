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

  it('has a field installation verified by head office before the agreement starts', async () => {
    const agent = await loginAs(ctx, 'FIELD_AGENT');
    const tech = await loginAs(ctx, 'TECHNICIAN');
    const pmAgent = { token: agent.token, staffId: agent.staff.id };
    // The fixture records the installation as the field agent: it waits for head office.
    const b = await activeAgreement(
      ctx,
      { ops: ops.token, finance: finance.token, pm: pm.token },
      { installAs: pmAgent },
    );
    const waiting = (
      await ctx.http.get(`/v1/agreements/${b.id}`).set(bearer(ops.token)).expect(200)
    ).body;
    expect(waiting.state).toBe('AWAITING_INSTALLATION');
    expect(waiting.installation).toMatchObject({ status: 'PENDING_VERIFICATION' });
    expect(waiting.allowed).toMatchObject({ install: false, verifyInstallation: true });
    const battery = await ctx.prisma.battery.findUniqueOrThrow({ where: { id: b.battery.id } });
    expect(battery.status).toBe('IN_STOCK');
    const s = (await ctx.http.get('/v1/field/summary').set(bearer(agent.token)).expect(200)).body;
    expect(s.installationsWaiting).toBe(0);

    // Only head office decides; a technician or the agent cannot.
    const pending = await ctx.http
      .get('/v1/installations/pending')
      .set(bearer(pm.token))
      .expect(200);
    expect(pending.body).toHaveLength(1);
    expect(pending.body[0]).toMatchObject({
      agreementNumber: b.number,
      recordedByName: expect.any(String),
    });
    const instId = pending.body[0].id as string;
    for (const who of [agent, tech, finance]) {
      await ctx.http
        .post(`/v1/agreements/${b.id}/installation/${instId}/verify`)
        .set(bearer(who.token))
        .expect(403);
    }

    // Rejected: the agent records it again; then an operations manager verifies it.
    await ctx.http
      .post(`/v1/agreements/${b.id}/installation/${instId}/reject`)
      .set(bearer(ops.token))
      .send({ reason: 'Photos do not show the serial number' })
      .expect(200);
    const rejected = (
      await ctx.http.get(`/v1/agreements/${b.id}`).set(bearer(ops.token)).expect(200)
    ).body;
    expect(rejected.installation).toMatchObject({
      status: 'REJECTED',
      rejectedReason: 'Photos do not show the serial number',
    });
    expect(rejected.allowed.install).toBe(true);
    const reinstall = (geo: Record<string, string>) => {
      const req = ctx.http
        .post(`/v1/agreements/${b.id}/installation`)
        .set(bearer(agent.token))
        .field('batteryId', b.battery.id)
        .field('technicianId', agent.staff.id)
        .field('installedAt', new Date().toISOString())
        .field('location', 'Baruipur')
        .field('voltageReading', '52.4')
        .field('conditionNote', 'Good')
        .field('driverConfirmed', 'true');
      for (const [k, v] of Object.entries(geo)) req.field(k, v);
      return req.attach('photos', PNG, 'p.png');
    };
    // Founder, 1 Nov 2026: the Field App records an installation only with the phone's location.
    expect((await reinstall({}).expect(422)).body.code).toBe('NO_LOCATION');
    expect(
      (await reinstall({ geoLat: '22.36', geoLng: '88.43', geoAccuracyM: '900' }).expect(422)).body
        .message,
    ).toMatch(/too rough/);
    await reinstall({ geoLat: '22.36', geoLng: '88.43', geoAccuracyM: '14' }).expect(200);
    const again = await ctx.http
      .get('/v1/installations/pending')
      .set(bearer(ops.token))
      .expect(200);
    const done = await ctx.http
      .post(`/v1/agreements/${b.id}/installation/${again.body[0].id}/verify`)
      .set(bearer(ops.token))
      .expect(200);
    expect(done.body.state).toBe('ACTIVE');
    expect(done.body.installation.geotag).toEqual({ lat: 22.36, lng: 88.43, accuracyM: 14 });
    expect(done.body.installation).toMatchObject({
      status: 'VERIFIED',
      decidedByName: expect.any(String),
    });
    const fitted = await ctx.prisma.battery.findUniqueOrThrow({ where: { id: b.battery.id } });
    expect(fitted.status).toBe('INSTALLED');
    await ctx.http
      .post(`/v1/agreements/${b.id}/installation/${again.body[0].id}/verify`)
      .set(bearer(ops.token))
      .expect(409);
  });

  it('puts an installation recorded by head office in force at once', async () => {
    const view = (await ctx.http.get(`/v1/agreements/${a.id}`).set(bearer(ops.token)).expect(200))
      .body;
    expect(view.state).toBe('ACTIVE');
    expect(view.installation.status).toBe('VERIFIED');
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

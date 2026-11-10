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
import { PNG, activeAgreement, approveInstallation, attachInstallPhotos } from './fixtures';

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

  it('has installation photos checked like KYC, then a final approval, before the agreement starts', async () => {
    const agent = await loginAs(ctx, 'FIELD_AGENT');
    const tech = await loginAs(ctx, 'TECHNICIAN');
    const asAgent = { token: agent.token, staffId: agent.staff.id };
    // The fixture records the installation as the field agent: it waits for head office.
    const b = await activeAgreement(
      ctx,
      { ops: ops.token, finance: finance.token, pm: pm.token },
      { installAs: asAgent },
    );
    const view = async () =>
      (await ctx.http.get(`/v1/agreements/${b.id}`).set(bearer(ops.token)).expect(200)).body;
    const waiting = await view();
    expect(waiting.state).toBe('AWAITING_INSTALLATION');
    expect(waiting.installation).toMatchObject({
      status: 'PENDING_VERIFICATION',
      readyForApproval: false,
    });
    expect(waiting.installation.photos).toHaveLength(5);
    expect(
      waiting.installation.items.map((i: { item: string; status: string }) => [i.item, i.status]),
    ).toEqual([
      ['BATTERY', 'PENDING'],
      ['GPS', 'PENDING'],
      ['VEHICLE', 'PENDING'],
      ['VOLTAGE', 'PENDING'],
      ['HANDOVER', 'PENDING'],
      ['OTHER', 'MISSING'],
    ]);
    expect(waiting.allowed).toMatchObject({ install: false, verifyInstallation: true });
    const battery = await ctx.prisma.battery.findUniqueOrThrow({ where: { id: b.battery.id } });
    expect(battery.status).toBe('IN_STOCK');
    const s = (await ctx.http.get('/v1/field/summary').set(bearer(agent.token)).expect(200)).body;
    expect(s.installationsWaiting).toBe(0);

    const pending = await ctx.http
      .get('/v1/installations/pending')
      .set(bearer(pm.token))
      .expect(200);
    expect(pending.body).toHaveLength(1);
    expect(pending.body[0]).toMatchObject({
      agreementNumber: b.number,
      recordedByName: expect.any(String),
      photosToCheck: 5,
      readyForApproval: false,
    });
    const instId = pending.body[0].id as string;
    const photo = (item: string, v = waiting) =>
      v.installation.photos.find(
        (p: { item: string; status: string }) => p.item === item && p.status === 'PENDING',
      ).id as string;
    const check = (who: string, item: string, verdict: 'verify' | 'reject', v = waiting) =>
      ctx.http
        .post(`/v1/agreements/${b.id}/installation/photos/${photo(item, v)}/${verdict}`)
        .set(bearer(who))
        .send(verdict === 'reject' ? { reason: 'IMEI not readable' } : {});
    const approve = (who: string) =>
      ctx.http.post(`/v1/agreements/${b.id}/installation/${instId}/approve`).set(bearer(who));

    // Founder, 10 Nov 2026: photos are checked like KYC (super admin, operations manager);
    // the plan manager gives the final approval only.
    for (const who of [agent, tech, finance, pm]) {
      await check(who.token, 'BATTERY', 'verify').expect(403);
    }
    for (const who of [agent, tech, finance]) await approve(who.token).expect(403);
    // Not before every required photo is verified.
    expect((await approve(pm.token).expect(409)).body.message).toMatch(/battery fitted/);

    for (const item of ['BATTERY', 'VEHICLE', 'VOLTAGE', 'HANDOVER']) {
      await check(ops.token, item, 'verify').expect(200);
    }
    await check(ops.token, 'GPS', 'reject').expect(200);
    const one = await view();
    expect(one.installation.items[1]).toMatchObject({ item: 'GPS', status: 'REJECTED' });
    expect(one.installation.photos.find((p: { item: string }) => p.item === 'GPS')).toMatchObject({
      status: 'REJECTED',
      reason: 'IMEI not readable',
      checkedByName: expect.any(String),
    });
    expect((await approve(pm.token).expect(409)).body.message).toMatch(/gps device/);
    // A checked photo cannot be checked again.
    await ctx.http
      .post(
        `/v1/agreements/${b.id}/installation/photos/${waiting.installation.photos[0].id}/reject`,
      )
      .set(bearer(ops.token))
      .send({ reason: 'Again' })
      .expect(409);

    // The agent takes a new GPS photo; a verified item cannot be replaced.
    const add = (item: string) =>
      ctx.http
        .post(`/v1/agreements/${b.id}/installation/${instId}/photos`)
        .set(bearer(agent.token))
        .field('item', item)
        .attach('photos', PNG, 'new.png');
    await add('BATTERY').expect(409);
    await add('GPS').expect(200);
    await add('GPS').expect(409);
    await add('OTHER').expect(200);
    const two = await view();
    expect(two.installation.readyForApproval).toBe(false);
    await check(ops.token, 'GPS', 'verify', two).expect(200);
    // A photo still waiting (other) holds up the final approval.
    await approve(pm.token).expect(409);
    await check(ops.token, 'OTHER', 'reject', two).expect(200);

    const done = (await approve(pm.token).expect(200)).body;
    expect(done.state).toBe('ACTIVE');
    expect(done.installation).toMatchObject({
      status: 'VERIFIED',
      readyForApproval: true,
      decidedByName: pm.staff.name,
    });
    const fitted = await ctx.prisma.battery.findUniqueOrThrow({ where: { id: b.battery.id } });
    expect(fitted.status).toBe('INSTALLED');
    await approve(pm.token).expect(409);
    await add('OTHER').expect(409);
    const audit = await ctx.prisma.auditLog.findMany({
      where: { action: { startsWith: 'agreement.install' } },
      select: { action: true },
    });
    expect(new Set(audit.map((x) => x.action))).toEqual(
      new Set([
        'agreement.install.recorded',
        'agreement.install.photo_verified',
        'agreement.install.photo_rejected',
        'agreement.install.photos_added',
        'agreement.install.approve',
      ]),
    );
  });

  it('sends a whole installation back to be recorded again, with the photos and location', async () => {
    const agent = await loginAs(ctx, 'FIELD_AGENT');
    const b = await activeAgreement(
      ctx,
      { ops: ops.token, finance: finance.token, pm: pm.token },
      { installAs: { token: agent.token, staffId: agent.staff.id } },
    );
    const instId = (
      await ctx.http.get('/v1/installations/pending').set(bearer(ops.token)).expect(200)
    ).body[0].id as string;
    await ctx.http
      .post(`/v1/agreements/${b.id}/installation/${instId}/reject`)
      .set(bearer(ops.token))
      .send({ reason: 'Wrong vehicle' })
      .expect(200);
    const rejected = (
      await ctx.http.get(`/v1/agreements/${b.id}`).set(bearer(ops.token)).expect(200)
    ).body;
    expect(rejected.installation).toMatchObject({
      status: 'REJECTED',
      rejectedReason: 'Wrong vehicle',
    });
    expect(rejected.allowed.install).toBe(true);
    const reinstall = (geo: Record<string, string>, items?: string[]) => {
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
      return attachInstallPhotos(req, items as never);
    };
    const geo = { geoLat: '22.36', geoLng: '88.43', geoAccuracyM: '14' };
    // Founder, 1 Nov 2026: the Field App records an installation only with the phone's location.
    expect((await reinstall({}).expect(422)).body.code).toBe('NO_LOCATION');
    expect((await reinstall({ ...geo, geoAccuracyM: '900' }).expect(422)).body.message).toMatch(
      /too rough/,
    );
    // Founder, 10 Nov 2026: a photo of every item.
    expect(
      (await reinstall(geo, ['BATTERY', 'VEHICLE', 'VOLTAGE']).expect(400)).body.message,
    ).toMatch(/gps device, driver handover/);
    await reinstall(geo).expect(200);
    const done = await approveInstallation(ctx, b.id, ops.token);
    expect(done.state).toBe('ACTIVE');
    expect(done.installation.geotag).toEqual({ lat: 22.36, lng: 88.43, accuracyM: 14 });
  });

  it('has an installation recorded by head office checked and approved too', async () => {
    const b = await activeAgreement(
      ctx,
      { ops: ops.token, finance: finance.token, pm: pm.token },
      { installAs: { token: ops.token, staffId: ops.staff.id } },
    );
    const view = (await ctx.http.get(`/v1/agreements/${b.id}`).set(bearer(ops.token)).expect(200))
      .body;
    expect(view.state).toBe('AWAITING_INSTALLATION');
    expect(view.installation.status).toBe('PENDING_VERIFICATION');
    expect((await approveInstallation(ctx, b.id, ops.token)).state).toBe('ACTIVE');
    // The usual fixture approves it: the agreement is active.
    const a2 = (await ctx.http.get(`/v1/agreements/${a.id}`).set(bearer(ops.token)).expect(200))
      .body;
    expect(a2).toMatchObject({ state: 'ACTIVE', installation: { status: 'VERIFIED' } });
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
    // Founder, 1 Nov 2026: field agents work service tickets too.
    expect(s.myOpenTickets).toBe(0);
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

import { addDays, rupeesToPaise as r } from '@voltneo/shared';
import { bearer, createTestApp, loginAs, resetData, type TestContext } from './helpers';
import { PNG, activeAgreement, makeBattery, makeBatteryType, publishedPlan } from './fixtures';

type Login = Awaited<ReturnType<typeof loginAs>>;
const H = 3_600_000;

describe('Operations: finishing early, ownership transfer, service tickets, dashboard (M4)', () => {
  let ctx: TestContext;
  let pm: Login;
  let ops: Login;
  let ops2: Login;
  let finance: Login;
  let support: Login;
  let tech: Login;
  let tech2: Login;
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
    support = await loginAs(ctx, 'SUPPORT');
    tech = await loginAs(ctx, 'TECHNICIAN');
    tech2 = await loginAs(ctx, 'TECHNICIAN');
    a = await activeAgreement(ctx, { ops: ops.token, finance: finance.token, pm: pm.token });
    ctx.messages.sent.length = 0;
  });

  afterEach(() => ctx.clock.reset());

  afterAll(async () => {
    await ctx.app.close();
  });

  const ownership = async (id = a.id) =>
    (await ctx.http.get(`/v1/agreements/${id}/ownership`).set(bearer(ops.token)).expect(200)).body;
  const agreement = async (id = a.id) =>
    (await ctx.http.get(`/v1/agreements/${id}`).set(bearer(ops.token)).expect(200)).body;
  const finishEarly = (total: number, quoted = total, id = a.id) =>
    ctx.http
      .post(`/v1/agreements/${id}/early-exit`)
      .set(bearer(finance.token))
      .send({
        agreementId: id,
        amountPaise: total,
        quotedTotalPaise: quoted,
        method: 'UPI',
        reference: `UTR${Date.now()}${Math.floor(Math.random() * 1000)}`,
      });
  const transfer = (by: string, at = ctx.clock.now().toISOString(), token = ops.token) =>
    ctx.http
      .post(`/v1/agreements/${a.id}/transfer`)
      .set(bearer(token))
      .send({ gpsOffAt: at, gpsPortalReference: 'GPSPORTAL-OFF-1', gpsOffById: by });
  const newTicket = (body: Record<string, unknown> = {}, token = support.token) =>
    ctx.http
      .post('/v1/tickets')
      .set(bearer(token))
      .send({
        agreementId: a.id,
        category: 'NOT_WORKING',
        channel: 'PHONE',
        description: 'Battery stops after 20 km since yesterday',
        ...body,
      });

  // ---------------------------------------------------------------------------
  // Finishing early (rule 13)
  // ---------------------------------------------------------------------------

  it('quotes every unpaid instalment and finishes early only at exactly that amount', async () => {
    const o = await ownership();
    expect(o.earlyExit).toMatchObject({
      remainingInstalments: r(54000),
      lateFeesDue: 0,
      total: r(54000),
      instalmentsLeft: 18,
      notYetDue: 18,
      resultingState: 'EARLY_EXIT',
    });
    expect(o.transferDue).toBe(false);

    // A stale or partial amount is refused, not taken as a part payment.
    const stale = await finishEarly(r(53000), r(53000)).expect(409);
    expect(stale.body).toMatchObject({ code: 'QUOTE_CHANGED', total: r(54000) });
    await finishEarly(r(54000), r(53000)).expect(409);
    // Support cannot take money.
    await ctx.http
      .post(`/v1/agreements/${a.id}/early-exit`)
      .set(bearer(support.token))
      .send({})
      .expect(403);

    const done = await finishEarly(r(54000)).expect(201);
    expect(done.body.payment.balanceAfter).toBe(0);
    expect(done.body.ownership).toMatchObject({
      state: 'EARLY_EXIT',
      earlyExit: null,
      transferDue: true,
      blockers: [],
    });
    expect(ctx.messages.sent.at(-1)!.template).toBe('payment_receipt');

    // Nothing more can be paid, and service has ended (D32).
    await ctx.http
      .post('/v1/payments')
      .set(bearer(finance.token))
      .send({ agreementId: a.id, amountPaise: r(100), method: 'CASH' })
      .expect(409);
    const t = await newTicket().expect(409);
    expect(t.body.message).toMatch(/belongs to the driver/);
  });

  it('is plain "paid off" when fewer than two instalments are still ahead (T34)', async () => {
    const typeId = (await makeBatteryType(ctx, pm.token, { purchase: 20000 })).id;
    const { versionId } = await publishedPlan(ctx, pm.token, typeId, { term: 1 });
    const one = await activeAgreement(
      ctx,
      { ops: ops.token, finance: finance.token, pm: pm.token },
      { typeId, versionId },
    );
    const o = await ownership(one.id);
    expect(o.earlyExit).toMatchObject({ total: r(3000), resultingState: 'PAID_OFF' });
    const done = await finishEarly(r(3000), r(3000), one.id).expect(201);
    expect(done.body.ownership.state).toBe('PAID_OFF');
  });

  it('includes late fees owed, and a disabled battery must be switched on before transfer', async () => {
    // Day 6 after the first due date: grace over, battery disabled, ₹100 fee.
    ctx.clock.set(addDays(a.firstDueDate, 6));
    await ctx.http.post('/v1/collections/run').set(bearer(ops.token)).send({}).expect(200);
    const req = await ctx.http
      .post(`/v1/agreements/${a.id}/immobilisation-request`)
      .set(bearer(ops.token))
      .send({ reason: 'No payment after final notice' })
      .expect(201);
    await ctx.http
      .post(`/v1/approval-requests/${req.body.id}/approve`)
      .set(bearer(ops2.token))
      .send({})
      .expect(200);
    await ctx.http
      .post(`/v1/agreements/${a.id}/immobilisation`)
      .set(bearer(ops.token))
      .send({
        action: 'DISABLE',
        performedAt: ctx.clock.now().toISOString(),
        portalReference: 'GPSPORTAL-1',
        vehicleStationaryConfirmed: true,
      })
      .expect(200);

    const o = await ownership();
    expect(o.state).toBe('IMMOBILISED');
    expect(o.earlyExit).toMatchObject({
      remainingInstalments: r(54000),
      lateFeesDue: r(100),
      total: r(54100),
    });
    const done = await finishEarly(r(54100)).expect(201);
    expect(done.body.ownership.state).toBe('EARLY_EXIT');
    expect(done.body.ownership.blockers[0]).toMatch(/still disabled/);

    const blocked = await transfer(ops.staff.id).expect(409);
    expect(blocked.body.message).toMatch(/still disabled/);

    // Paying everything created the restore task; record it, then transfer.
    await ctx.http
      .post(`/v1/agreements/${a.id}/immobilisation`)
      .set(bearer(ops.token))
      .send({
        action: 'RESTORE',
        performedAt: ctx.clock.now().toISOString(),
        portalReference: 'GPSPORTAL-2',
      })
      .expect(200);
    expect((await ownership()).blockers).toEqual([]);
    await transfer(ops.staff.id).expect(200);
    expect((await agreement()).state).toBe('TRANSFERRED');
  });

  // ---------------------------------------------------------------------------
  // Ownership transfer (rule 14)
  // ---------------------------------------------------------------------------

  it('transfers ownership: GPS off recorded, certificate issued, battery is the driver’s', async () => {
    await transfer(ops.staff.id).expect(409); // not paid yet

    const open = await newTicket().expect(201);
    await finishEarly(r(54000)).expect(201);
    const blocked = await transfer(ops.staff.id).expect(409);
    expect(blocked.body.message).toMatch(/service ticket is still open/);
    await ctx.http
      .post(`/v1/tickets/${open.body.id}/cancel`)
      .set(bearer(support.token))
      .send({ reason: 'Driver says it works again' })
      .expect(200);

    // Only operations managers and the super admin; the GPS person must be allowed too.
    await transfer(ops.staff.id, undefined, finance.token).expect(403);
    await transfer(finance.staff.id).expect(400);
    await transfer(ops.staff.id, new Date(Date.now() + 10 * 60_000).toISOString()).expect(400);
    await transfer(ops.staff.id, new Date(Date.now() - 24 * H).toISOString()).expect(400);

    ctx.messages.sent.length = 0;
    const res = await transfer(ops2.staff.id).expect(200);
    expect(res.body.state).toBe('TRANSFERRED');
    expect(res.body.transferDue).toBe(false);
    expect(res.body.transfer).toMatchObject({
      certificateNumber: expect.stringMatching(/^VNC\/\d{4}-\d{2}\/000001$/),
      gpsPortalReference: 'GPSPORTAL-OFF-1',
      gpsOffByName: ops2.staff.name,
      recordedByName: ops.staff.name,
    });
    const sms = ctx.messages.sent.at(-1)!;
    expect(sms.template).toBe('ownership_transferred');
    expect(sms.body).toContain(a.battery.serial);
    expect(sms.body).toContain(res.body.transfer.certificateNumber);

    const battery = await ctx.prisma.battery.findUniqueOrThrow({ where: { id: a.battery.id } });
    expect(battery).toMatchObject({ status: 'TRANSFERRED', holder: 'DRIVER' });
    const custody = await ctx.prisma.batteryCustody.findMany({
      where: { batteryId: a.battery.id },
      orderBy: { at: 'asc' },
    });
    expect(custody.at(-1)!.event).toBe('OWNERSHIP_TRANSFERRED');
    const events = (await agreement()).events.map((e: { event: string }) => e.event);
    expect(events).toContain('TRANSFERRED');

    for (const lang of ['BN', 'HI', 'EN']) {
      const pdf = await ctx.http
        .get(`/v1/agreements/${a.id}/certificate?lang=${lang}`)
        .set(bearer(support.token))
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

    // Final: no second transfer, no record changes.
    await transfer(ops.staff.id).expect(409);
    await expect(
      ctx.prisma.ownershipTransfer.updateMany({ data: { note: 'changed' } }),
    ).rejects.toThrow(/append-only/);
  });

  it('has no certificate before transfer', async () => {
    await ctx.http.get(`/v1/agreements/${a.id}/certificate`).set(bearer(ops.token)).expect(404);
  });

  // ---------------------------------------------------------------------------
  // Service tickets (module 10)
  // ---------------------------------------------------------------------------

  it('logs a fault with the 48-hour deadline, which turns red when missed', async () => {
    await newTicket({}, tech.token).expect(403); // technicians do not open tickets
    const created = await newTicket().expect(201);
    const t = created.body;
    expect(t).toMatchObject({
      number: 'VNS-000001',
      status: 'OPEN',
      timing: 'ON_TIME',
      batterySerial: a.battery.serial,
      allowed: { assign: true, visit: false, cancel: true },
    });
    expect(new Date(t.dueBy).getTime() - new Date(t.reportedAt).getTime()).toBe(48 * H);
    const sms = ctx.messages.sent.at(-1)!;
    expect(sms.template).toBe('ticket_received');
    expect(sms.body).toContain('VNS-000001');
    expect(sms.body).toContain('48');

    const at = (h: number) => new Date(new Date(t.reportedAt).getTime() + h * H);
    ctx.clock.set(at(43));
    let list = (await ctx.http.get('/v1/tickets').set(bearer(support.token)).expect(200)).body;
    expect(list.items[0].timing).toBe('DUE_SOON');
    ctx.clock.set(at(49));
    list = (await ctx.http.get('/v1/tickets?timing=MISSED').set(bearer(support.token)).expect(200))
      .body;
    expect(list.items.map((i: { id: string }) => i.id)).toEqual([t.id]);
    expect(list.counts).toEqual({ open: 1, assigned: 0, missed: 1 });

    // Assign: only someone who can do service visits.
    await ctx.http
      .patch(`/v1/tickets/${t.id}`)
      .set(bearer(support.token))
      .send({ technicianId: finance.staff.id })
      .expect(400);
    await ctx.http
      .patch(`/v1/tickets/${t.id}`)
      .set(bearer(support.token))
      .send({ technicianId: tech.staff.id })
      .expect(200);

    // Another technician cannot record on it; the assigned one can.
    ctx.clock.set(at(51));
    await ctx.http
      .post(`/v1/tickets/${t.id}/visits`)
      .set(bearer(tech2.token))
      .field('visitedAt', at(50).toISOString())
      .field('finding', 'Checked')
      .expect(403);
    await ctx.http
      .post(`/v1/tickets/${t.id}/resolve`)
      .set(bearer(tech.token))
      .send({ outcome: 'REPAIRED', resolution: 'Fixed' })
      .expect(409); // no visit yet
    const visited = await ctx.http
      .post(`/v1/tickets/${t.id}/visits`)
      .set(bearer(tech.token))
      .field('visitedAt', at(50).toISOString())
      .field('voltageReading', '47.9')
      .field('readingsNote', 'Cell 3 low')
      .field('finding', 'Loose terminal, tightened and retested')
      .attach('photos', PNG, 'terminal.png')
      .expect(201);
    expect(visited.body).toMatchObject({ timing: 'MET_LATE', allowed: { resolve: true } });
    expect(visited.body.visits[0]).toMatchObject({ voltageReading: '47.9', photos: [{}] });

    await ctx.http
      .post(`/v1/tickets/${t.id}/resolve`)
      .set(bearer(tech.token))
      .send({ outcome: 'REPLACED', resolution: 'Swapped' })
      .expect(409); // no replacement recorded
    ctx.messages.sent.length = 0;
    const resolved = await ctx.http
      .post(`/v1/tickets/${t.id}/resolve`)
      .set(bearer(tech.token))
      .send({ outcome: 'REPAIRED', resolution: 'Terminal tightened; battery holds charge' })
      .expect(200);
    expect(resolved.body).toMatchObject({ status: 'RESOLVED', outcome: 'REPAIRED' });
    expect(ctx.messages.sent[0]!.template).toBe('ticket_resolved');

    // Final.
    await ctx.http
      .post(`/v1/tickets/${t.id}/cancel`)
      .set(bearer(support.token))
      .send({ reason: 'oops' })
      .expect(409);
    await expect(
      ctx.prisma.serviceTicket.update({ where: { id: t.id }, data: { resolution: 'x' } }),
    ).rejects.toThrow(/cannot be changed/);

    const history = await ctx.http
      .get(`/v1/batteries/${a.battery.id}/service-history`)
      .set(bearer(ops.token))
      .expect(200);
    expect(history.body).toHaveLength(1);
    expect(history.body[0]).toMatchObject({
      voltageReading: '47.9',
      ticket: { number: 'VNS-000001' },
    });
  });

  it('replaces a faulty battery on the same agreement and payment schedule (clause C8)', async () => {
    const t = (await newTicket({ technicianId: tech.staff.id }).expect(201)).body;
    expect(t.status).toBe('ASSIGNED');
    const otherType = await makeBatteryType(ctx, pm.token);
    const wrongType = await makeBattery(ctx, ops.token, otherType.id);
    const noGps = await makeBattery(ctx, ops.token, a.typeId, { gps: false });
    const fresh = await makeBattery(ctx, ops.token, a.typeId);
    const replace = (batteryId: string) =>
      ctx.http
        .post(`/v1/tickets/${t.id}/replacement`)
        .set(bearer(tech.token))
        .field('newBatteryId', batteryId)
        .field('replacedAt', new Date().toISOString())
        .field('voltageReading', '52.8')
        .field('oldBatteryNote', 'Does not hold charge; cell imbalance');
    await replace(wrongType.id).expect(422);
    await replace(noGps.id).expect(422);
    await replace(a.battery.id).expect(409); // installed, not in stock

    // The database refuses a battery change that is not a recorded replacement.
    await expect(
      ctx.prisma.agreement.update({ where: { id: a.id }, data: { batteryId: fresh.id } }),
    ).rejects.toThrow(/cannot be changed/);

    const done = await replace(fresh.id).attach('photos', PNG, 'swap.png').expect(201);
    expect(done.body.replacements[0]).toMatchObject({
      oldBatterySerial: a.battery.serial,
      newBatterySerial: fresh.serial,
    });
    expect(done.body.respondedAt).not.toBeNull();
    await replace(fresh.id).expect(409); // only once per ticket

    const ag = await agreement();
    expect(ag.battery.serial).toBe(fresh.serial);
    expect(ag.state).toBe('ACTIVE');
    expect(ag.terms.totalPayable).toBe(r(74000));
    expect(ag.events.map((e: { event: string }) => e.event)).toContain('BATTERY_REPLACED');
    const [oldB, newB] = await Promise.all([
      ctx.prisma.battery.findUniqueOrThrow({ where: { id: a.battery.id } }),
      ctx.prisma.battery.findUniqueOrThrow({ where: { id: fresh.id } }),
    ]);
    expect(oldB).toMatchObject({
      status: 'UNDER_REPAIR',
      holder: 'TECHNICIAN',
      holderStaffId: tech.staff.id,
    });
    expect(newB).toMatchObject({ status: 'INSTALLED', holder: 'DRIVER' });

    await ctx.http
      .post(`/v1/tickets/${t.id}/resolve`)
      .set(bearer(tech.token))
      .send({ outcome: 'NO_FAULT_FOUND', resolution: 'Nothing wrong' })
      .expect(422);
    await ctx.http
      .post(`/v1/tickets/${t.id}/cancel`)
      .set(bearer(support.token))
      .send({ reason: 'Duplicate' })
      .expect(409);
    await ctx.http
      .post(`/v1/tickets/${t.id}/resolve`)
      .set(bearer(ops.token))
      .send({ outcome: 'REPLACED', resolution: 'Battery replaced under clause C6' })
      .expect(200);

    // New faults are logged against the new battery.
    const next = (await newTicket().expect(201)).body;
    expect(next.batterySerial).toBe(fresh.serial);
  });

  // ---------------------------------------------------------------------------
  // Dashboard (module 11) and audit log (module 12)
  // ---------------------------------------------------------------------------

  it('summarises the business with money that matches the ledger', async () => {
    await ctx.http
      .post('/v1/payments')
      .set(bearer(finance.token))
      .send({ agreementId: a.id, amountPaise: r(1500), method: 'UPI', reference: 'UTR123456' })
      .expect(201);
    await newTicket().expect(201);
    await ctx.http.get('/v1/reports/summary').set(bearer(support.token)).expect(403);
    const s = (await ctx.http.get('/v1/reports/summary').set(bearer(ops.token)).expect(200)).body;
    expect(s.activeDrivers).toBe(1);
    expect(s.received.day).toMatchObject({
      total: r(21500),
      count: 2,
      downPayments: r(20000),
      instalments: r(1500),
      lateFees: 0,
      matchesLedger: true,
      byMethod: { CASH: { amount: r(20000), count: 1 }, UPI: { amount: r(1500), count: 1 } },
    });
    expect(s.received.month.total).toBeGreaterThanOrEqual(r(21500));
    expect(s.batteries).toMatchObject({ INSTALLED: 1 });
    expect(s.tickets).toMatchObject({ open: 1, missed: 0 });
    expect(s.cash.withAgents).toBe(r(20000));
    expect(s.agreements.transferDue).toBe(0);

    // A day with nothing received.
    const quiet = (
      await ctx.http
        .get(`/v1/reports/summary?date=${addDays(s.today, -40)}`)
        .set(bearer(ops.token))
        .expect(200)
    ).body;
    expect(quiet.received.day).toMatchObject({ total: 0, count: 0, matchesLedger: true });
    await ctx.http
      .get(`/v1/reports/summary?date=${addDays(s.today, 1)}`)
      .set(bearer(ops.token))
      .expect(400);
  });

  it('shows who changed what in the audit log, with filters', async () => {
    const admin = await loginAs(ctx, 'SUPER_ADMIN');
    await newTicket().expect(201);
    const facets = (await ctx.http.get('/v1/audit-log/facets').set(bearer(admin.token)).expect(200))
      .body;
    expect(facets.tables.map((t: { tableName: string }) => t.tableName)).toContain(
      'service_tickets',
    );
    expect(facets.actions.map((x: { action: string }) => x.action)).toContain('ticket.create');
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
    const log = (
      await ctx.http
        .get(`/v1/audit-log?action=ticket.create&from=${today}&to=${today}`)
        .set(bearer(admin.token))
        .expect(200)
    ).body;
    expect(log.items).toHaveLength(1);
    expect(log.items[0]).toMatchObject({ actorName: support.staff.name, actorRole: 'SUPPORT' });
    await ctx.http.get('/v1/audit-log').set(bearer(ops.token)).expect(403);
  });
});

import { rupeesToPaise as r } from '@voltneo/shared';
import { bearer, createTestApp, loginAs, resetData, type TestContext } from './helpers';
import { makeBatteryType, makePlan } from './fixtures';

describe('Plans with versions and the cost floor (module 4)', () => {
  let ctx: TestContext;
  let pm: Awaited<ReturnType<typeof loginAs>>;
  let typeA: { id: string };
  let typeB: { id: string };

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  beforeEach(async () => {
    await resetData(ctx.prisma);
    pm = await loginAs(ctx, 'PLAN_MANAGER');
    // Floors: A = ₹70,000, B = ₹80,000
    typeA = await makeBatteryType(ctx, pm.token, {
      purchase: 60000,
      allowances: 10000,
      name: 'Neo 48',
    });
    typeB = await makeBatteryType(ctx, pm.token, {
      purchase: 70000,
      allowances: 10000,
      name: 'Neo 60',
    });
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  const grid = (down: number, monthly: number) => [
    { batteryTypeId: typeA.id, downPayment: r(down), instalment: r(monthly) },
    { batteryTypeId: typeB.id, downPayment: r(down + 5000), instalment: r(monthly + 500) },
  ];

  async function draftWithPrices(term: number, down: number, monthly: number) {
    const p = await makePlan(ctx, pm.token);
    const v = p.versions[0]!;
    await ctx.http
      .patch(`/v1/plan-versions/${v.id}`)
      .set(bearer(pm.token))
      .send({ termMonths: term, prices: grid(down, monthly) })
      .expect(200);
    return { plan: p, versionId: v.id };
  }

  describe('creating plans', () => {
    it('assigns a fixed code and a first draft carrying the current non-payment terms', async () => {
      const p = await makePlan(ctx, pm.token, 'Balanced');
      expect(p.code).toBe('NO-P01');
      const second = await makePlan(ctx, pm.token);
      expect(second.code).toBe('NO-P02');
      const full = await ctx.http.get(`/v1/plans/${p.id}`).set(bearer(pm.token)).expect(200);
      expect(full.body.versions[0]).toMatchObject({
        version: 1,
        status: 'DRAFT',
        graceDays: 5,
        lateFeePerDayPaise: r(100),
        lateFeeCapDays: 30,
      });
    });

    it('needs names in all three languages and blocks unsupported claims (D27)', async () => {
      const missing = await ctx.http
        .post('/v1/plans')
        .set(bearer(pm.token))
        .send({ nameBn: '', nameHi: 'आसान', nameEn: 'Easy' })
        .expect(400);
      expect(missing.body.message).toContain('Bengali name is required');
      const claim = await ctx.http
        .post('/v1/plans')
        .set(bearer(pm.token))
        .send({ nameBn: 'সহজ', nameHi: 'आसान', nameEn: 'Cheapest Battery' })
        .expect(400);
      expect(claim.body.message[0]).toMatch(/unsupported claim/);
    });

    it('stops two live plans sharing a name, ignoring case and spacing', async () => {
      await makePlan(ctx, pm.token, 'Own Faster');
      const res = await ctx.http
        .post('/v1/plans')
        .set(bearer(pm.token))
        .send({ nameBn: 'দ্রুত', nameHi: 'तेज़', nameEn: '  own   FASTER ' })
        .expect(409);
      expect(res.body.message).toMatch(/English name is already used by plan NO-P01/);
    });

    it('lets only head office create or change plans (D26)', async () => {
      for (const role of ['FIELD_AGENT', 'FINANCE', 'OPERATIONS_MANAGER', 'SUPPORT'] as const) {
        const { token } = await loginAs(ctx, role);
        await ctx.http
          .post('/v1/plans')
          .set(bearer(token))
          .send({ nameBn: 'ক', nameHi: 'क', nameEn: 'Nope Plan' })
          .expect(403);
      }
    });
  });

  describe('the price grid', () => {
    it('calculates total payable for each battery type', async () => {
      const { plan } = await draftWithPrices(18, 20000, 3000);
      const res = await ctx.http.get(`/v1/plans/${plan.id}`).set(bearer(pm.token)).expect(200);
      const prices = res.body.versions[0].prices;
      expect(
        prices.map((p: { batteryTypeName: string; totalPayable: number }) => [
          p.batteryTypeName,
          p.totalPayable,
        ]),
      ).toEqual([
        ['Neo 48', r(74000)],
        ['Neo 60', r(25000 + 18 * 3500)],
      ]);
    });

    it('recalculates totals when the term changes', async () => {
      const { plan, versionId } = await draftWithPrices(18, 20000, 3000);
      await ctx.http
        .patch(`/v1/plan-versions/${versionId}`)
        .set(bearer(pm.token))
        .send({ termMonths: 24 })
        .expect(200);
      const res = await ctx.http.get(`/v1/plans/${plan.id}`).set(bearer(pm.token)).expect(200);
      expect(res.body.versions[0].prices[0].totalPayable).toBe(r(20000 + 24 * 3000));
    });

    it('refuses archived battery types and repeated rows', async () => {
      const p = await makePlan(ctx, pm.token);
      const v = p.versions[0]!.id;
      await ctx.http
        .patch(`/v1/plan-versions/${v}`)
        .set(bearer(pm.token))
        .send({ termMonths: 12, prices: [grid(1, 1)[0], grid(1, 1)[0]] })
        .expect(400);
      await ctx.http
        .patch(`/v1/battery-types/${typeB.id}`)
        .set(bearer(pm.token))
        .send({ status: 'ARCHIVED' })
        .expect(200);
      await ctx.http
        .patch(`/v1/plan-versions/${v}`)
        .set(bearer(pm.token))
        .send({ termMonths: 12, prices: grid(1, 1) })
        .expect(422);
    });
  });

  describe('publishing', () => {
    it('publishes at once when every price clears its floor, freezing names and floors', async () => {
      const { plan, versionId } = await draftWithPrices(18, 20000, 3000); // 74,000 ≥ 70,000; 88,000 ≥ 80,000
      const check = await ctx.http
        .get(`/v1/plan-versions/${versionId}/check`)
        .set(bearer(pm.token))
        .expect(200);
      expect(check.body.passes).toBe(true);
      const res = await ctx.http
        .post(`/v1/plan-versions/${versionId}/publish`)
        .set(bearer(pm.token))
        .send({})
        .expect(200);
      expect(res.body.outcome).toBe('PUBLISHED');
      expect(res.body.plan.status).toBe('ACTIVE');
      const v = res.body.plan.versions[0];
      expect(v).toMatchObject({
        status: 'PUBLISHED',
        costFloorPassed: true,
        costFloorException: false,
      });
      expect(v.names.en).toBe(
        plan.versions.length
          ? (await ctx.prisma.plan.findUniqueOrThrow({ where: { id: plan.id } })).nameEn
          : '',
      );
      expect(v.prices.map((p: { costFloor: number }) => p.costFloor)).toEqual([r(70000), r(80000)]);
    });

    it('never changes a published version: the API refuses and so does the database (rule 1)', async () => {
      const { versionId } = await draftWithPrices(18, 20000, 3000);
      await ctx.http
        .post(`/v1/plan-versions/${versionId}/publish`)
        .set(bearer(pm.token))
        .send({})
        .expect(200);
      await ctx.http
        .patch(`/v1/plan-versions/${versionId}`)
        .set(bearer(pm.token))
        .send({ termMonths: 6 })
        .expect(409);
      await expect(
        ctx.prisma.$executeRawUnsafe(
          `UPDATE "plan_versions" SET "term_months" = 6 WHERE id = '${versionId}'`,
        ),
      ).rejects.toThrow(/cannot be changed/);
      await expect(
        ctx.prisma.$executeRawUnsafe(`UPDATE "plan_version_prices" SET "instalment" = 1`),
      ).rejects.toThrow(/cannot be changed/);
      await expect(
        ctx.prisma.$executeRawUnsafe(`DELETE FROM "plan_versions" WHERE id = '${versionId}'`),
      ).rejects.toThrow(/cannot be deleted/);
    });

    it('keeps the signed names on the published version when the plan is renamed (D27)', async () => {
      const { plan, versionId } = await draftWithPrices(18, 20000, 3000);
      await ctx.http
        .post(`/v1/plan-versions/${versionId}/publish`)
        .set(bearer(pm.token))
        .send({})
        .expect(200);
      const before = (await ctx.prisma.plan.findUniqueOrThrow({ where: { id: plan.id } })).nameEn;
      const res = await ctx.http
        .patch(`/v1/plans/${plan.id}`)
        .set(bearer(pm.token))
        .send({ nameEn: 'Renamed Plan' })
        .expect(200);
      expect(res.body.names.en).toBe('Renamed Plan');
      expect(res.body.code).toBe(plan.code);
      expect(res.body.versions[0].names.en).toBe(before);
      expect(await ctx.prisma.auditLog.count({ where: { action: 'plan.rename' } })).toBe(1);
    });

    it('starts a new version from the latest terms and supersedes the old one on publish', async () => {
      const { plan, versionId } = await draftWithPrices(18, 20000, 3000);
      await ctx.http
        .post(`/v1/plan-versions/${versionId}/publish`)
        .set(bearer(pm.token))
        .send({})
        .expect(200);
      const withDraft = await ctx.http
        .post(`/v1/plans/${plan.id}/versions`)
        .set(bearer(pm.token))
        .expect(201);
      const v2 = withDraft.body.versions[0];
      expect(v2).toMatchObject({ version: 2, status: 'DRAFT', termMonths: 18 });
      expect(v2.prices).toHaveLength(2);
      await ctx.http.post(`/v1/plans/${plan.id}/versions`).set(bearer(pm.token)).expect(409);
      await ctx.http
        .patch(`/v1/plan-versions/${v2.id}`)
        .set(bearer(pm.token))
        .send({ termMonths: 20 })
        .expect(200);
      const res = await ctx.http
        .post(`/v1/plan-versions/${v2.id}/publish`)
        .set(bearer(pm.token))
        .send({})
        .expect(200);
      expect(
        res.body.plan.versions.map((v: { version: number; status: string }) => [
          v.version,
          v.status,
        ]),
      ).toEqual([
        [2, 'PUBLISHED'],
        [1, 'SUPERSEDED'],
      ]);
    });

    it('refuses to publish an incomplete draft', async () => {
      const p = await makePlan(ctx, pm.token);
      const res = await ctx.http
        .post(`/v1/plan-versions/${p.versions[0]!.id}/publish`)
        .set(bearer(pm.token))
        .send({})
        .expect(422);
      expect(res.body.message).toEqual(
        expect.arrayContaining([
          'Set the number of instalments',
          'Add a price for at least one battery type',
        ]),
      );
    });
  });

  describe('below the cost floor (spec rule 2, D26)', () => {
    it('blocks publishing and explains which prices are short', async () => {
      const { versionId } = await draftWithPrices(12, 10000, 4000); // A: 58,000 < 70,000
      const res = await ctx.http
        .post(`/v1/plan-versions/${versionId}/publish`)
        .set(bearer(pm.token))
        .send({})
        .expect(422);
      expect(res.body.code).toBe('BELOW_COST_FLOOR');
      const short = res.body.check.rows.find((x: { passes: boolean }) => !x.passes);
      expect(short).toMatchObject({
        batteryTypeName: 'Neo 48',
        totalPayable: r(58000),
        costFloor: r(70000),
        margin: -r(12000),
      });
    });

    it('goes live only after a second head-office person approves an exception', async () => {
      const { plan, versionId } = await draftWithPrices(12, 10000, 4000);
      const res = await ctx.http
        .post(`/v1/plan-versions/${versionId}/publish`)
        .set(bearer(pm.token))
        .send({ exceptionReason: 'Pilot launch offer for 50 drivers' })
        .expect(200);
      expect(res.body.outcome).toBe('PENDING_APPROVAL');
      expect(res.body.plan.versions[0].status).toBe('PENDING_APPROVAL');
      await ctx.http
        .patch(`/v1/plan-versions/${versionId}`)
        .set(bearer(pm.token))
        .send({ termMonths: 6 })
        .expect(409);

      const reqId = res.body.approvalRequestId;
      await ctx.http
        .post(`/v1/approval-requests/${reqId}/approve`)
        .set(bearer(pm.token))
        .send({})
        .expect(403);
      const ops = await loginAs(ctx, 'OPERATIONS_MANAGER');
      await ctx.http
        .post(`/v1/approval-requests/${reqId}/approve`)
        .set(bearer(ops.token))
        .send({})
        .expect(403);

      const second = await loginAs(ctx, 'PLAN_MANAGER');
      await ctx.http
        .post(`/v1/approval-requests/${reqId}/approve`)
        .set(bearer(second.token))
        .send({ note: 'Agreed for pilot' })
        .expect(200);
      const after = await ctx.http.get(`/v1/plans/${plan.id}`).set(bearer(pm.token)).expect(200);
      expect(after.body.status).toBe('ACTIVE');
      expect(after.body.versions[0]).toMatchObject({
        status: 'PUBLISHED',
        costFloorPassed: false,
        costFloorException: true,
        exceptionApprovedById: second.staff.id,
        publishedById: pm.staff.id,
      });
    });

    it('returns a rejected exception to draft so it can be fixed', async () => {
      const { versionId } = await draftWithPrices(12, 10000, 4000);
      const res = await ctx.http
        .post(`/v1/plan-versions/${versionId}/publish`)
        .set(bearer(pm.token))
        .send({ exceptionReason: 'Try it' })
        .expect(200);
      const admin = await loginAs(ctx, 'SUPER_ADMIN');
      await ctx.http
        .post(`/v1/approval-requests/${res.body.approvalRequestId}/reject`)
        .set(bearer(admin.token))
        .send({ note: 'Raise the instalment' })
        .expect(200);
      await ctx.http
        .patch(`/v1/plan-versions/${versionId}`)
        .set(bearer(pm.token))
        .send({ termMonths: 24 })
        .expect(200);
      const ok = await ctx.http
        .post(`/v1/plan-versions/${versionId}/publish`)
        .set(bearer(pm.token))
        .send({})
        .expect(200);
      expect(ok.body.outcome).toBe('PUBLISHED');
    });

    it('flags a live plan that falls below the floor after costs rise', async () => {
      const { versionId } = await draftWithPrices(18, 20000, 3000);
      await ctx.http
        .post(`/v1/plan-versions/${versionId}/publish`)
        .set(bearer(pm.token))
        .send({})
        .expect(200);
      let list = await ctx.http.get('/v1/plans').set(bearer(pm.token)).expect(200);
      expect(list.body[0].belowFloorNow).toBe(false);
      await ctx.http
        .post(`/v1/battery-types/${typeA.id}/costs`)
        .set(bearer(pm.token))
        .send({ purchaseCost: r(80000) })
        .expect(201);
      list = await ctx.http.get('/v1/plans').set(bearer(pm.token)).expect(200);
      expect(list.body[0].belowFloorNow).toBe(true);
      expect(list.body[0].published.status).toBe('PUBLISHED');
    });
  });

  describe('what field agents see', () => {
    it('shows plans and prices to field agents without any cost information', async () => {
      const { versionId } = await draftWithPrices(18, 20000, 3000);
      await ctx.http
        .post(`/v1/plan-versions/${versionId}/publish`)
        .set(bearer(pm.token))
        .send({})
        .expect(200);
      const agent = await loginAs(ctx, 'FIELD_AGENT');
      const res = await ctx.http.get('/v1/plans').set(bearer(agent.token)).expect(200);
      const text = JSON.stringify(res.body);
      expect(res.body[0].published.prices[0].totalPayable).toBe(r(74000));
      expect(text).not.toMatch(/costFloor"|belowFloorNow"|purchaseCost/);
      await ctx.http
        .get(`/v1/plan-versions/${versionId}/check`)
        .set(bearer(agent.token))
        .expect(403);
    });
  });

  describe('retiring and drafts', () => {
    it('retires a plan, frees its name, and can discard a later draft', async () => {
      const { plan, versionId } = await draftWithPrices(18, 20000, 3000);
      await ctx.http
        .post(`/v1/plan-versions/${versionId}/publish`)
        .set(bearer(pm.token))
        .send({})
        .expect(200);
      const v2 = (
        await ctx.http.post(`/v1/plans/${plan.id}/versions`).set(bearer(pm.token)).expect(201)
      ).body.versions[0];
      const discarded = await ctx.http
        .post(`/v1/plan-versions/${v2.id}/discard`)
        .set(bearer(pm.token))
        .expect(200);
      expect(discarded.body.versions).toHaveLength(1);
      await ctx.http
        .post(`/v1/plan-versions/${versionId}/discard`)
        .set(bearer(pm.token))
        .expect(409);
      const retired = await ctx.http
        .patch(`/v1/plans/${plan.id}`)
        .set(bearer(pm.token))
        .send({ status: 'RETIRED' })
        .expect(200);
      expect(retired.body.status).toBe('RETIRED');
      const name = (await ctx.prisma.plan.findUniqueOrThrow({ where: { id: plan.id } })).nameEn;
      await ctx.http
        .post('/v1/plans')
        .set(bearer(pm.token))
        .send({ nameBn: 'নতুন', nameHi: 'नया', nameEn: name })
        .expect(201);
    });
  });
});

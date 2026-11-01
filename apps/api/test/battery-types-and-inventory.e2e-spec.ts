import { rupeesToPaise as r } from '@voltneo/shared';
import {
  bearer,
  createStaff,
  createTestApp,
  loginAs,
  resetData,
  type TestContext,
} from './helpers';
import { makeBatteryType } from './fixtures';

describe('Battery types (module 2) and inventory (module 3)', () => {
  let ctx: TestContext;
  let plan: string; // plan manager token
  let ops: Awaited<ReturnType<typeof loginAs>>;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  beforeEach(async () => {
    await resetData(ctx.prisma);
    plan = (await loginAs(ctx, 'PLAN_MANAGER')).token;
    ops = await loginAs(ctx, 'OPERATIONS_MANAGER');
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  describe('battery types', () => {
    it('saves specs and the cost basis, and calculates the cost floor', async () => {
      const res = await ctx.http
        .post('/v1/battery-types')
        .set(bearer(plan))
        .send({
          name: 'Neo 51',
          voltage: 51.2,
          capacityAh: 105,
          chemistry: 'LFP',
          supplier: 'Supplier A',
          warrantyMonths: 36,
          compatibleVehicles: ['TOTO'],
          cost: {
            purchaseCost: r(55000),
            gpsCost: r(3000),
            serviceCost: r(4000),
            financingCost: r(6000),
            collectionCost: r(1500),
            expectedLossCost: r(5500),
          },
        })
        .expect(201);
      expect(res.body).toMatchObject({
        name: 'Neo 51',
        voltage: 51.2,
        capacityAh: 105,
        status: 'ACTIVE',
      });
      expect(res.body.currentCost.costFloor).toBe(r(75000));
      expect(res.body.costHistory).toHaveLength(1);
    });

    it('keeps cost history: a change adds a row and the database refuses edits', async () => {
      const t = await makeBatteryType(ctx, plan, { purchase: 50000 });
      await ctx.http
        .post(`/v1/battery-types/${t.id}/costs`)
        .set(bearer(plan))
        .send({ purchaseCost: r(52000), note: 'New quote' })
        .expect(201);
      const res = await ctx.http.get(`/v1/battery-types/${t.id}`).set(bearer(plan)).expect(200);
      expect(res.body.costHistory.map((c: { purchaseCost: number }) => c.purchaseCost)).toEqual([
        r(52000),
        r(50000),
      ]);
      expect(res.body.currentCost.purchaseCost).toBe(r(52000));
      await expect(
        ctx.prisma.$executeRawUnsafe(`UPDATE "battery_type_costs" SET "purchase_cost" = 1`),
      ).rejects.toThrow(/append-only/);
      await expect(
        ctx.prisma.$executeRawUnsafe(`DELETE FROM "battery_type_costs"`),
      ).rejects.toThrow(/append-only/);
      expect(
        await ctx.prisma.auditLog.count({ where: { action: 'battery_type.cost_change' } }),
      ).toBe(1);
    });

    it('rejects an inconsistent cost floor even if written directly to the database', async () => {
      const t = await makeBatteryType(ctx, plan);
      await expect(
        ctx.prisma.$executeRawUnsafe(
          `INSERT INTO "battery_type_costs" (id, battery_type_id, purchase_cost, cost_floor) VALUES (gen_random_uuid(), '${t.id}', 100, 50)`,
        ),
      ).rejects.toThrow(/battery_type_costs_amounts_valid/);
    });

    it('hides costs from roles without cost access, and lets only head office manage types', async () => {
      const t = await makeBatteryType(ctx, plan);
      const asOps = await ctx.http
        .get(`/v1/battery-types/${t.id}`)
        .set(bearer(ops.token))
        .expect(200);
      expect(asOps.body.currentCost).toBeUndefined();
      expect(asOps.body.costHistory).toBeUndefined();
      const finance = await loginAs(ctx, 'FINANCE');
      const asFinance = await ctx.http
        .get('/v1/battery-types')
        .set(bearer(finance.token))
        .expect(200);
      expect(asFinance.body[0].currentCost.purchaseCost).toBe(r(50000));
      await ctx.http
        .post(`/v1/battery-types/${t.id}/costs`)
        .set(bearer(finance.token))
        .send({ purchaseCost: 1 })
        .expect(403);
      const agent = await loginAs(ctx, 'FIELD_AGENT');
      await ctx.http.get('/v1/battery-types').set(bearer(agent.token)).expect(403);
    });

    it('refuses duplicate names and zero purchase cost', async () => {
      await makeBatteryType(ctx, plan, { name: 'Neo 60' });
      const dup = await ctx.http
        .post('/v1/battery-types')
        .set(bearer(plan))
        .send({
          name: 'Neo 60',
          voltage: 60,
          capacityAh: 100,
          chemistry: 'LFP',
          supplier: 'Supplier',
          warrantyMonths: 12,
          compatibleVehicles: [],
          cost: { purchaseCost: r(1) },
        })
        .expect(409);
      expect(dup.body.message).toMatch(/already exists/);
      await ctx.http
        .post('/v1/battery-types')
        .set(bearer(plan))
        .send({
          name: 'Neo 61',
          voltage: 60,
          capacityAh: 100,
          chemistry: 'LFP',
          supplier: 'Supplier',
          warrantyMonths: 12,
          compatibleVehicles: [],
          cost: { purchaseCost: 0 },
        })
        .expect(400);
    });
  });

  describe('inventory', () => {
    it('registers a battery, normalising the serial and using the current purchase cost by default', async () => {
      const t = await makeBatteryType(ctx, plan, { purchase: 50000 });
      const res = await ctx.http
        .post('/v1/batteries')
        .set(bearer(ops.token))
        .send({
          serial: 'neo51 000123',
          gpsDeviceId: '3569 3803-5643 809',
          batteryTypeId: t.id,
          purchaseDate: '2026-10-20',
          location: 'Head office store',
        })
        .expect(201);
      expect(res.body).toMatchObject({
        serial: 'NEO51000123',
        gpsDeviceId: '356938035643809',
        status: 'IN_STOCK',
        holder: 'STOCK',
      });
      const row = await ctx.prisma.battery.findUniqueOrThrow({ where: { id: res.body.id } });
      expect(row.purchaseCost).toBe(r(50000));
      expect(res.body.custody).toHaveLength(1);
      expect(res.body.custody[0]).toMatchObject({ event: 'REGISTERED', toStatus: 'IN_STOCK' });
    });

    it('refuses a repeated serial or IMEI, a malformed IMEI, and archived battery types', async () => {
      const t = await makeBatteryType(ctx, plan);
      const base = { batteryTypeId: t.id, purchaseDate: '2026-10-20' };
      await ctx.http
        .post('/v1/batteries')
        .set(bearer(ops.token))
        .send({ ...base, serial: 'A-001', gpsDeviceId: '356938035643801' })
        .expect(201);
      const s = await ctx.http
        .post('/v1/batteries')
        .set(bearer(ops.token))
        .send({ ...base, serial: 'a-001' })
        .expect(409);
      expect(s.body.message).toMatch(/serial/);
      const g = await ctx.http
        .post('/v1/batteries')
        .set(bearer(ops.token))
        .send({ ...base, serial: 'A-002', gpsDeviceId: '356938035643801' })
        .expect(409);
      expect(g.body.message).toMatch(/IMEI/);
      for (const bad of ['GPS-77', '35693803564380', '3569380356438012']) {
        const res = await ctx.http
          .post('/v1/batteries')
          .set(bearer(ops.token))
          .send({ ...base, serial: 'A-004', gpsDeviceId: bad })
          .expect(400);
        expect(JSON.stringify(res.body)).toMatch(/15 digits/);
      }
      await ctx.http
        .patch(`/v1/battery-types/${t.id}`)
        .set(bearer(plan))
        .send({ status: 'ARCHIVED' })
        .expect(200);
      await ctx.http
        .post('/v1/batteries')
        .set(bearer(ops.token))
        .send({ ...base, serial: 'A-003' })
        .expect(422);
    });

    it('registers a delivery in bulk, all or nothing, listing every problem', async () => {
      const t = await makeBatteryType(ctx, plan);
      await ctx.http
        .post('/v1/batteries')
        .set(bearer(ops.token))
        .send({ batteryTypeId: t.id, purchaseDate: '2026-10-20', serial: 'B-100' })
        .expect(201);
      const bad = await ctx.http
        .post('/v1/batteries/bulk')
        .set(bearer(ops.token))
        .send({
          batteryTypeId: t.id,
          purchaseDate: '2026-10-21',
          supplierRef: 'INV-77',
          items: [
            { serial: 'B-101', gpsDeviceId: '356938035643801' },
            { serial: 'B-100' },
            { serial: 'B-101' },
            { serial: 'B-103', gpsDeviceId: '356938035643801' },
          ],
        })
        .expect(422);
      expect(bad.body.errors.map((e: { row: number }) => e.row)).toEqual([2, 3, 4]);
      expect(await ctx.prisma.battery.count()).toBe(1);

      const ok = await ctx.http
        .post('/v1/batteries/bulk')
        .set(bearer(ops.token))
        .send({
          batteryTypeId: t.id,
          purchaseDate: '2026-10-21',
          items: Array.from({ length: 25 }, (_, i) => ({
            serial: `C-${i}`,
            gpsDeviceId: String(356938035643800 + i),
          })),
        })
        .expect(201);
      expect(ok.body).toEqual({ created: 25 });
      const list = await ctx.http
        .get(`/v1/batteries?batteryTypeId=${t.id}&limit=10`)
        .set(bearer(ops.token))
        .expect(200);
      expect(list.body.total).toBe(26);
      expect(list.body.items).toHaveLength(10);
      const search = await ctx.http
        .get('/v1/batteries?search=643807')
        .set(bearer(ops.token))
        .expect(200);
      expect(search.body.items.map((b: { serial: string }) => b.serial)).toEqual(['C-7']);
    });

    it('sends a battery to a technician for repair and back, recording custody', async () => {
      const t = await makeBatteryType(ctx, plan);
      const tech = await createStaff(ctx.prisma, 'TECHNICIAN', { name: 'Bikash' });
      const b = (
        await ctx.http
          .post('/v1/batteries')
          .set(bearer(ops.token))
          .send({
            batteryTypeId: t.id,
            purchaseDate: '2026-10-20',
            serial: 'R-1',
            location: 'Store',
          })
          .expect(201)
      ).body;
      await ctx.http
        .post(`/v1/batteries/${b.id}/status`)
        .set(bearer(ops.token))
        .send({ to: 'UNDER_REPAIR', technicianId: tech.id, note: 'Swollen cell' })
        .expect(201);
      const back = await ctx.http
        .post(`/v1/batteries/${b.id}/status`)
        .set(bearer(ops.token))
        .send({ to: 'IN_STOCK', location: 'Store' })
        .expect(201);
      expect(back.body.custody.map((c: { event: string }) => c.event)).toEqual([
        'REGISTERED',
        'SENT_FOR_REPAIR',
        'RETURNED_TO_STOCK',
      ]);
      expect(back.body.custody[1]).toMatchObject({ toHolder: 'TECHNICIAN', toStaffName: 'Bikash' });
      await expect(ctx.prisma.$executeRawUnsafe(`DELETE FROM "battery_custody"`)).rejects.toThrow(
        /append-only/,
      );
    });

    it('refuses moves that only their own workflow may make', async () => {
      const t = await makeBatteryType(ctx, plan);
      const b = (
        await ctx.http
          .post('/v1/batteries')
          .set(bearer(ops.token))
          .send({ batteryTypeId: t.id, purchaseDate: '2026-10-20', serial: 'M-1' })
          .expect(201)
      ).body;
      await ctx.http
        .post(`/v1/batteries/${b.id}/status`)
        .set(bearer(ops.token))
        .send({ to: 'IN_STOCK' })
        .expect(409);
      await ctx.http
        .post(`/v1/batteries/${b.id}/status`)
        .set(bearer(ops.token))
        .send({ to: 'INSTALLED' })
        .expect(400);
      const notTech = await createStaff(ctx.prisma, 'FINANCE');
      await ctx.http
        .post(`/v1/batteries/${b.id}/status`)
        .set(bearer(ops.token))
        .send({ to: 'UNDER_REPAIR', technicianId: notTech.id })
        .expect(400);
    });

    it('lets technicians see inventory but not change it', async () => {
      const t = await makeBatteryType(ctx, plan);
      const tech = await loginAs(ctx, 'TECHNICIAN');
      await ctx.http.get('/v1/batteries').set(bearer(tech.token)).expect(200);
      await ctx.http
        .post('/v1/batteries')
        .set(bearer(tech.token))
        .send({ batteryTypeId: t.id, purchaseDate: '2026-10-20', serial: 'T-1' })
        .expect(403);
      const list = await ctx.http.get('/v1/batteries').set(bearer(tech.token)).expect(200);
      expect(
        list.body.items.every((b: { purchaseCost?: number }) => b.purchaseCost === undefined),
      ).toBe(true);
    });
  });

  describe('retiring a battery (maker-checker)', () => {
    async function battery() {
      const t = await makeBatteryType(ctx, plan);
      return (
        await ctx.http
          .post('/v1/batteries')
          .set(bearer(ops.token))
          .send({
            batteryTypeId: t.id,
            purchaseDate: '2026-10-20',
            serial: `X-${Math.random().toString(36).slice(2, 8)}`,
          })
          .expect(201)
      ).body as { id: string };
    }

    it('needs a second person: the requester cannot approve their own request', async () => {
      const b = await battery();
      const req = (
        await ctx.http
          .post(`/v1/batteries/${b.id}/retire`)
          .set(bearer(ops.token))
          .send({ reason: 'Cell damage beyond repair' })
          .expect(201)
      ).body;
      expect(req).toMatchObject({ type: 'BATTERY_RETIRE', status: 'PENDING' });
      const own = await ctx.http
        .post(`/v1/approval-requests/${req.id}/approve`)
        .set(bearer(ops.token))
        .send({})
        .expect(403);
      expect(own.body.message).toMatch(/your own/);

      const second = await loginAs(ctx, 'OPERATIONS_MANAGER');
      const list = await ctx.http
        .get('/v1/approval-requests?status=PENDING')
        .set(bearer(second.token))
        .expect(200);
      expect(list.body[0]).toMatchObject({
        id: req.id,
        canDecide: true,
        requestedByName: ops.staff.name,
      });
      await ctx.http
        .post(`/v1/approval-requests/${req.id}/approve`)
        .set(bearer(second.token))
        .send({ note: 'Checked' })
        .expect(200);

      const after = await ctx.http.get(`/v1/batteries/${b.id}`).set(bearer(ops.token)).expect(200);
      expect(after.body).toMatchObject({ status: 'RETIRED', holder: 'RETIRED' });
      expect(after.body.retiredAt).not.toBeNull();
      expect(after.body.custody.at(-1)).toMatchObject({
        event: 'RETIRED',
        note: 'Cell damage beyond repair',
      });
      expect(
        await ctx.prisma.auditLog.count({
          where: { action: { in: ['approval.request', 'approval.approved', 'battery.retire'] } },
        }),
      ).toBe(3);
    });

    it('refuses an approver whose role does not cover the action', async () => {
      const b = await battery();
      const req = (
        await ctx.http
          .post(`/v1/batteries/${b.id}/retire`)
          .set(bearer(ops.token))
          .send({ reason: 'End of life' })
          .expect(201)
      ).body;
      const finance = await loginAs(ctx, 'FINANCE');
      await ctx.http
        .post(`/v1/approval-requests/${req.id}/approve`)
        .set(bearer(finance.token))
        .send({})
        .expect(403);
      const support = await loginAs(ctx, 'SUPPORT');
      await ctx.http
        .post(`/v1/approval-requests/${req.id}/approve`)
        .set(bearer(support.token))
        .send({})
        .expect(403);
    });

    it('allows one pending request at a time, blocks moves while pending, and can be rejected or cancelled', async () => {
      const b = await battery();
      const req = (
        await ctx.http
          .post(`/v1/batteries/${b.id}/retire`)
          .set(bearer(ops.token))
          .send({ reason: 'End of life' })
          .expect(201)
      ).body;
      await ctx.http
        .post(`/v1/batteries/${b.id}/retire`)
        .set(bearer(ops.token))
        .send({ reason: 'Again please' })
        .expect(409);
      await ctx.http
        .post(`/v1/batteries/${b.id}/status`)
        .set(bearer(ops.token))
        .send({ to: 'UNDER_REPAIR' })
        .expect(409);

      const admin = await loginAs(ctx, 'SUPER_ADMIN');
      await ctx.http
        .post(`/v1/approval-requests/${req.id}/reject`)
        .set(bearer(admin.token))
        .send({})
        .expect(400);
      await ctx.http
        .post(`/v1/approval-requests/${req.id}/reject`)
        .set(bearer(admin.token))
        .send({ note: 'Still repairable' })
        .expect(200);
      await ctx.http
        .post(`/v1/approval-requests/${req.id}/approve`)
        .set(bearer(admin.token))
        .send({})
        .expect(409);
      const after = await ctx.http.get(`/v1/batteries/${b.id}`).set(bearer(ops.token)).expect(200);
      expect(after.body.status).toBe('IN_STOCK');

      const again = (
        await ctx.http
          .post(`/v1/batteries/${b.id}/retire`)
          .set(bearer(ops.token))
          .send({ reason: 'Third look' })
          .expect(201)
      ).body;
      await ctx.http
        .post(`/v1/approval-requests/${again.id}/cancel`)
        .set(bearer(admin.token))
        .expect(403);
      await ctx.http
        .post(`/v1/approval-requests/${again.id}/cancel`)
        .set(bearer(ops.token))
        .expect(200);
    });
  });
});

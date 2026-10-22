import request from 'supertest';
import {
  bearer,
  createStaff,
  createTestApp,
  login,
  loginAs,
  resetData,
  type TestContext,
} from './helpers';

describe('Staff and roles (module 1)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  beforeEach(async () => {
    await resetData(ctx.prisma);
    ctx.otp.sent.length = 0;
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  describe('creating staff', () => {
    it('lets a super admin create a staff member, normalising email and phone, and audits it', async () => {
      const { token, staff: admin } = await loginAs(ctx, 'SUPER_ADMIN');
      const res = await ctx.http
        .post('/v1/staff')
        .set(bearer(token))
        .send({
          name: '  Rina Das ',
          email: 'Rina@VoltNeo.test',
          phone: '98300 12345',
          role: 'FIELD_AGENT',
        })
        .expect(201);
      expect(res.body).toMatchObject({
        name: 'Rina Das',
        email: 'rina@voltneo.test',
        phone: '+919830012345',
        role: 'FIELD_AGENT',
        status: 'ACTIVE',
      });
      const audit = await ctx.prisma.auditLog.findFirstOrThrow({
        where: { action: 'staff.create', recordId: res.body.id },
      });
      expect(audit.actorId).toBe(admin.id);
      expect(audit.after).toMatchObject({ role: 'FIELD_AGENT', email: 'rina@voltneo.test' });
      expect(audit.requestId).toEqual(expect.any(String));
    });

    it('lets the new staff member log in straight away', async () => {
      const { token } = await loginAs(ctx, 'SUPER_ADMIN');
      await ctx.http
        .post('/v1/staff')
        .set(bearer(token))
        .send({ name: 'Tapan', phone: '9123456780', role: 'TECHNICIAN' })
        .expect(201);
      const s = await login(ctx, '+91 91234 56780');
      expect(s.body.staff).toMatchObject({ role: 'TECHNICIAN' });
    });

    it('requires an email or a phone number', async () => {
      const { token } = await loginAs(ctx, 'SUPER_ADMIN');
      const res = await ctx.http
        .post('/v1/staff')
        .set(bearer(token))
        .send({ name: 'No Contact', role: 'SUPPORT' })
        .expect(400);
      expect(res.body.message).toMatch(/email or a phone/);
    });

    it('rejects an invalid phone, an invalid role and unknown fields', async () => {
      const { token } = await loginAs(ctx, 'SUPER_ADMIN');
      await ctx.http
        .post('/v1/staff')
        .set(bearer(token))
        .send({ name: 'X Y', phone: '12345', role: 'SUPPORT' })
        .expect(400);
      await ctx.http
        .post('/v1/staff')
        .set(bearer(token))
        .send({ name: 'X Y', email: 'x@y.co', role: 'KING' })
        .expect(400);
      await ctx.http
        .post('/v1/staff')
        .set(bearer(token))
        .send({ name: 'X Y', email: 'x@y.co', role: 'SUPPORT', status: 'ACTIVE' })
        .expect(400);
    });

    it('refuses a duplicate email, ignoring case', async () => {
      const { token } = await loginAs(ctx, 'SUPER_ADMIN');
      await createStaff(ctx.prisma, 'FINANCE', { email: 'dup@voltneo.test' });
      const res = await ctx.http
        .post('/v1/staff')
        .set(bearer(token))
        .send({ name: 'Dup', email: 'DUP@voltneo.test', role: 'SUPPORT' })
        .expect(409);
      expect(res.body.message).toMatch(/email/);
    });

    it('refuses a duplicate phone written differently', async () => {
      const { token } = await loginAs(ctx, 'SUPER_ADMIN');
      await createStaff(ctx.prisma, 'FINANCE', { phone: '+919830012345' });
      await ctx.http
        .post('/v1/staff')
        .set(bearer(token))
        .send({ name: 'Dup', phone: '09830012345', role: 'SUPPORT' })
        .expect(409);
    });
  });

  describe('role checks on every action (spec section 2)', () => {
    it('lets only the super admin create or change staff', async () => {
      const target = await createStaff(ctx.prisma, 'SUPPORT');
      for (const role of [
        'PLAN_MANAGER',
        'OPERATIONS_MANAGER',
        'FINANCE',
        'SUPPORT',
        'FIELD_AGENT',
        'TECHNICIAN',
        'RECOVERY',
      ] as const) {
        const { token } = await loginAs(ctx, role);
        await ctx.http
          .post('/v1/staff')
          .set(bearer(token))
          .send({ name: 'Nope', email: `nope.${role}@x.co`, role: 'SUPPORT' })
          .expect(403);
        await ctx.http
          .patch(`/v1/staff/${target.id}`)
          .set(bearer(token))
          .send({ role: 'SUPER_ADMIN' })
          .expect(403);
      }
    });

    it('lets the operations manager view staff (to assign agents) but not support or field roles', async () => {
      const ops = await loginAs(ctx, 'OPERATIONS_MANAGER');
      await ctx.http.get('/v1/staff').set(bearer(ops.token)).expect(200);
      for (const role of ['SUPPORT', 'FIELD_AGENT', 'TECHNICIAN', 'RECOVERY', 'FINANCE'] as const) {
        const { token } = await loginAs(ctx, role);
        await ctx.http.get('/v1/staff').set(bearer(token)).expect(403);
      }
    });

    it('applies a role change at once and makes the person log in again', async () => {
      const { token } = await loginAs(ctx, 'SUPER_ADMIN');
      const ops = await loginAs(ctx, 'OPERATIONS_MANAGER');
      await ctx.http.get('/v1/staff').set(bearer(ops.token)).expect(200);

      const res = await ctx.http
        .patch(`/v1/staff/${ops.staff.id}`)
        .set(bearer(token))
        .send({ role: 'SUPPORT' })
        .expect(200);
      expect(res.body.role).toBe('SUPPORT');
      await ctx.http.get('/v1/staff').set(bearer(ops.token)).expect(401);

      const again = await login(ctx, ops.staff.email!);
      await ctx.http.get('/v1/staff').set(bearer(again.accessToken)).expect(403);

      const audit = await ctx.prisma.auditLog.findFirstOrThrow({
        where: { action: 'staff.role_change', recordId: ops.staff.id },
      });
      expect(audit.before).toMatchObject({ role: 'OPERATIONS_MANAGER' });
      expect(audit.after).toMatchObject({ role: 'SUPPORT' });
    });
  });

  describe('deactivating staff', () => {
    it('blocks a deactivated staff member from logging in or using an existing session', async () => {
      const { token } = await loginAs(ctx, 'SUPER_ADMIN');
      const agent = await loginAs(ctx, 'FIELD_AGENT');
      await ctx.http
        .patch(`/v1/staff/${agent.staff.id}`)
        .set(bearer(token))
        .send({ status: 'DEACTIVATED' })
        .expect(200);

      await ctx.http.get('/v1/auth/me').set(bearer(agent.token)).expect(401);
      ctx.otp.sent.length = 0;
      await ctx.http
        .post('/v1/auth/otp/request')
        .send({ identifier: agent.staff.email })
        .expect(202);
      expect(ctx.otp.sent).toHaveLength(0);

      const row = await ctx.prisma.staffUser.findUniqueOrThrow({ where: { id: agent.staff.id } });
      expect(row.deactivatedAt).not.toBeNull();
      const sessions = await ctx.prisma.staffSession.findMany({
        where: { staffId: agent.staff.id },
      });
      expect(sessions.every((s) => s.revokedReason === 'staff_deactivated')).toBe(true);
    });

    it('allows reactivation', async () => {
      const { token } = await loginAs(ctx, 'SUPER_ADMIN');
      const agent = await createStaff(ctx.prisma, 'FIELD_AGENT', { status: 'DEACTIVATED' });
      await ctx.http
        .patch(`/v1/staff/${agent.id}`)
        .set(bearer(token))
        .send({ status: 'ACTIVE' })
        .expect(200);
      await login(ctx, agent.email!);
      expect(await ctx.prisma.auditLog.count({ where: { action: 'staff.reactivate' } })).toBe(1);
    });

    it('stops a super admin deactivating themselves or changing their own role', async () => {
      const { token, staff } = await loginAs(ctx, 'SUPER_ADMIN');
      await ctx.http
        .patch(`/v1/staff/${staff.id}`)
        .set(bearer(token))
        .send({ status: 'DEACTIVATED' })
        .expect(403);
      await ctx.http
        .patch(`/v1/staff/${staff.id}`)
        .set(bearer(token))
        .send({ role: 'FINANCE' })
        .expect(403);
    });

    it('never leaves Volt Neo without an active super admin, even under simultaneous changes', async () => {
      const a = await loginAs(ctx, 'SUPER_ADMIN');
      const b = await loginAs(ctx, 'SUPER_ADMIN');
      const results = await Promise.all([
        request(ctx.app.getHttpServer())
          .patch(`/v1/staff/${b.staff.id}`)
          .set(bearer(a.token))
          .send({ status: 'DEACTIVATED' }),
        request(ctx.app.getHttpServer())
          .patch(`/v1/staff/${a.staff.id}`)
          .set(bearer(b.token))
          .send({ status: 'DEACTIVATED' }),
      ]);
      expect(results.every((r) => [200, 401, 403, 409].includes(r.status))).toBe(true);
      const active = await ctx.prisma.staffUser.count({
        where: { role: 'SUPER_ADMIN', status: 'ACTIVE' },
      });
      expect(active).toBeGreaterThanOrEqual(1);
    });
  });

  describe('reading staff', () => {
    it('lists, filters and searches staff', async () => {
      const { token } = await loginAs(ctx, 'SUPER_ADMIN');
      await createStaff(ctx.prisma, 'TECHNICIAN', { name: 'Bikash Roy' });
      await createStaff(ctx.prisma, 'TECHNICIAN', { name: 'Sumit Pal', status: 'DEACTIVATED' });
      await createStaff(ctx.prisma, 'FINANCE', { name: 'Anita Sen' });

      const techs = await ctx.http.get('/v1/staff?role=TECHNICIAN').set(bearer(token)).expect(200);
      expect(techs.body.map((s: { name: string }) => s.name).sort()).toEqual([
        'Bikash Roy',
        'Sumit Pal',
      ]);
      const active = await ctx.http
        .get('/v1/staff?role=TECHNICIAN&status=ACTIVE')
        .set(bearer(token))
        .expect(200);
      expect(active.body).toHaveLength(1);
      const search = await ctx.http.get('/v1/staff?search=anita').set(bearer(token)).expect(200);
      expect(search.body).toHaveLength(1);
    });

    it('returns 404 for an unknown ID and 400 for a malformed one', async () => {
      const { token } = await loginAs(ctx, 'SUPER_ADMIN');
      await ctx.http
        .get('/v1/staff/00000000-0000-4000-8000-000000000000')
        .set(bearer(token))
        .expect(404);
      await ctx.http.get('/v1/staff/not-a-uuid').set(bearer(token)).expect(400);
    });
  });
});

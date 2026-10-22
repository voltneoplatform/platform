import {
  bearer,
  createStaff,
  createTestApp,
  login,
  loginAs,
  resetData,
  type TestContext,
} from './helpers';

describe('Audit log (module 12) and platform basics', () => {
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

  describe('append-only audit log (rule 17)', () => {
    beforeEach(async () => {
      await ctx.prisma.auditLog.create({
        data: { actorType: 'SYSTEM', action: 'test.event', tableName: 'test' },
      });
    });

    it('refuses UPDATE at the database level', async () => {
      await expect(
        ctx.prisma.$executeRawUnsafe(`UPDATE "audit_log" SET "action" = 'tampered'`),
      ).rejects.toThrow(/append-only/);
    });

    it('refuses DELETE at the database level', async () => {
      await expect(ctx.prisma.$executeRawUnsafe(`DELETE FROM "audit_log"`)).rejects.toThrow(
        /append-only/,
      );
    });

    it('refuses TRUNCATE at the database level', async () => {
      await expect(ctx.prisma.$executeRawUnsafe(`TRUNCATE "audit_log"`)).rejects.toThrow(
        /append-only/,
      );
    });

    it('never stores codes or token hashes', async () => {
      const staff = await createStaff(ctx.prisma, 'FINANCE');
      const s = await login(ctx, staff.email!);
      await ctx.http.post('/v1/auth/refresh').send({ refreshToken: s.refreshToken }).expect(200);
      const rows = await ctx.prisma.auditLog.findMany();
      const all = JSON.stringify(rows, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
      expect(all).not.toContain(s.refreshToken!);
      expect(all).not.toContain(ctx.otp.sent[0]!.code);
    });
  });

  describe('reading the audit log', () => {
    it('is visible only to roles with audit permission (super admin)', async () => {
      const admin = await loginAs(ctx, 'SUPER_ADMIN');
      await ctx.http.get('/v1/audit-log').set(bearer(admin.token)).expect(200);
      for (const role of [
        'PLAN_MANAGER',
        'OPERATIONS_MANAGER',
        'FINANCE',
        'SUPPORT',
        'FIELD_AGENT',
      ] as const) {
        const { token } = await loginAs(ctx, role);
        await ctx.http.get('/v1/audit-log').set(bearer(token)).expect(403);
      }
    });

    it('filters by record and pages from newest to oldest', async () => {
      const admin = await loginAs(ctx, 'SUPER_ADMIN');
      for (let i = 0; i < 5; i++) {
        await ctx.prisma.auditLog.create({
          data: { actorType: 'SYSTEM', action: 'test.event', tableName: 'things', recordId: 'r1' },
        });
      }
      const page1 = await ctx.http
        .get('/v1/audit-log?tableName=things&recordId=r1&limit=2')
        .set(bearer(admin.token))
        .expect(200);
      expect(page1.body.items).toHaveLength(2);
      expect(Number(page1.body.items[0].id)).toBeGreaterThan(Number(page1.body.items[1].id));
      const page2 = await ctx.http
        .get(`/v1/audit-log?tableName=things&recordId=r1&limit=2&before=${page1.body.nextBefore}`)
        .set(bearer(admin.token))
        .expect(200);
      expect(Number(page2.body.items[0].id)).toBeLessThan(Number(page1.body.items[1].id));
    });

    it('has no route that changes audit entries', async () => {
      const admin = await loginAs(ctx, 'SUPER_ADMIN');
      await ctx.http.delete('/v1/audit-log').set(bearer(admin.token)).expect(404);
      await ctx.http.patch('/v1/audit-log/1').set(bearer(admin.token)).send({}).expect(404);
    });
  });

  describe('platform', () => {
    it('reports health without login', async () => {
      const res = await ctx.http.get('/v1/health').expect(200);
      expect(res.body).toMatchObject({ status: 'ok', database: 'up' });
    });

    it('adds a request ID to every response and keeps a safe incoming one', async () => {
      const res = await ctx.http
        .get('/v1/health')
        .set('x-request-id', 'trace-abc-12345')
        .expect(200);
      expect(res.headers['x-request-id']).toBe('trace-abc-12345');
      const fresh = await ctx.http.get('/v1/health').set('x-request-id', '<script>').expect(200);
      expect(fresh.headers['x-request-id']).not.toBe('<script>');
    });

    it('sends security headers', async () => {
      const res = await ctx.http.get('/v1/health').expect(200);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-powered-by']).toBeUndefined();
    });

    it('enforces the database rules even if code is bypassed', async () => {
      await expect(
        ctx.prisma.$executeRawUnsafe(
          `INSERT INTO "staff_users" (id, name, role, updated_at) VALUES (gen_random_uuid(), 'x', 'SUPPORT', now())`,
        ),
      ).rejects.toThrow(/staff_users_contact_present/);
      await expect(
        ctx.prisma.$executeRawUnsafe(
          `INSERT INTO "staff_users" (id, name, email, role, updated_at) VALUES (gen_random_uuid(), 'x', 'Upper@X.co', 'SUPPORT', now())`,
        ),
      ).rejects.toThrow(/staff_users_email_lowercase/);
    });
  });
});

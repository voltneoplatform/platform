import { createHash } from 'node:crypto';
import request from 'supertest';
import { bearer, createStaff, createTestApp, login, resetData, type TestContext } from './helpers';

describe('Staff login with OTP (module 1)', () => {
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

  describe('requesting a code', () => {
    it('sends a 6-digit code by email to an active staff member', async () => {
      const staff = await createStaff(ctx.prisma, 'FINANCE', { email: 'mitra@voltneo.test' });
      const res = await ctx.http
        .post('/v1/auth/otp/request')
        .send({ identifier: 'Mitra@VoltNeo.test' })
        .expect(202);
      expect(res.body).toEqual({ sent: true, expiresInSeconds: 300 });
      expect(ctx.otp.sent).toHaveLength(1);
      expect(ctx.otp.sent[0]).toMatchObject({
        channel: 'EMAIL',
        destination: 'mitra@voltneo.test',
        recipientName: staff.name,
      });
      expect(ctx.otp.sent[0]!.code).toMatch(/^\d{6}$/);
    });

    it('sends by SMS when the staff member types a phone number in any common format', async () => {
      await createStaff(ctx.prisma, 'FIELD_AGENT', { email: null, phone: '+919830012345' });
      for (const typed of ['9830012345', '+91 98300 12345', '098300-12345']) {
        ctx.otp.sent.length = 0;
        await ctx.prisma.otpChallenge.deleteMany();
        await ctx.http.post('/v1/auth/otp/request').send({ identifier: typed }).expect(202);
        expect(ctx.otp.sent[0]).toMatchObject({ channel: 'SMS', destination: '+919830012345' });
      }
    });

    it('gives the same answer for unknown and deactivated accounts, and sends nothing', async () => {
      await createStaff(ctx.prisma, 'SUPPORT', {
        email: 'gone@voltneo.test',
        status: 'DEACTIVATED',
      });
      const unknown = await ctx.http
        .post('/v1/auth/otp/request')
        .send({ identifier: 'nobody@voltneo.test' })
        .expect(202);
      const deactivated = await ctx.http
        .post('/v1/auth/otp/request')
        .send({ identifier: 'gone@voltneo.test' })
        .expect(202);
      const garbage = await ctx.http
        .post('/v1/auth/otp/request')
        .send({ identifier: 'not an id' })
        .expect(202);
      expect(unknown.body).toEqual(deactivated.body);
      expect(garbage.body).toEqual(deactivated.body);
      expect(ctx.otp.sent).toHaveLength(0);
    });

    it('stores only a hash of the code', async () => {
      const staff = await createStaff(ctx.prisma, 'FINANCE');
      await ctx.http.post('/v1/auth/otp/request').send({ identifier: staff.email }).expect(202);
      const row = await ctx.prisma.otpChallenge.findFirstOrThrow({ where: { staffId: staff.id } });
      expect(row.codeHash).not.toContain(ctx.otp.sent[0]!.code);
      expect(row.codeHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('rejects a body with unexpected fields', async () => {
      await ctx.http
        .post('/v1/auth/otp/request')
        .send({ identifier: 'a@b.co', role: 'SUPER_ADMIN' })
        .expect(400);
    });
  });

  describe('verifying a code', () => {
    it('logs in and returns the staff profile and role permissions', async () => {
      const staff = await createStaff(ctx.prisma, 'OPERATIONS_MANAGER');
      const { body } = await login(ctx, staff.email!);
      expect(body.accessToken).toEqual(expect.any(String));
      expect(body.refreshToken).toEqual(expect.any(String));
      expect(body.staff).toMatchObject({
        id: staff.id,
        role: 'OPERATIONS_MANAGER',
        status: 'ACTIVE',
      });
      expect(body.permissions).toEqual(
        expect.arrayContaining(['admin_panel.access', 'collections.read']),
      );
      expect(body.permissions).not.toContain('payments.record');

      const after = await ctx.prisma.staffUser.findUniqueOrThrow({ where: { id: staff.id } });
      expect(after.lastLoginAt).not.toBeNull();
      const audit = await ctx.prisma.auditLog.findFirst({
        where: { action: 'auth.login', actorId: staff.id },
      });
      expect(audit).not.toBeNull();
    });

    it('rejects a wrong code', async () => {
      const staff = await createStaff(ctx.prisma, 'FINANCE');
      await ctx.http.post('/v1/auth/otp/request').send({ identifier: staff.email }).expect(202);
      const right = ctx.otp.sent[0]!.code;
      const wrong = right === '000000' ? '111111' : '000000';
      const res = await ctx.http
        .post('/v1/auth/otp/verify')
        .send({ identifier: staff.email, code: wrong })
        .expect(401);
      expect(res.body.message).toMatch(/wrong or has expired/);
    });

    it('locks the code after 5 wrong attempts, even if the 6th is right', async () => {
      const staff = await createStaff(ctx.prisma, 'FINANCE');
      await ctx.http.post('/v1/auth/otp/request').send({ identifier: staff.email }).expect(202);
      const right = ctx.otp.sent[0]!.code;
      const wrong = right === '000000' ? '111111' : '000000';
      for (let i = 0; i < 5; i++) {
        await ctx.http
          .post('/v1/auth/otp/verify')
          .send({ identifier: staff.email, code: wrong })
          .expect(401);
      }
      await ctx.http
        .post('/v1/auth/otp/verify')
        .send({ identifier: staff.email, code: right })
        .expect(401);
    });

    it('does not accept the same code twice', async () => {
      const staff = await createStaff(ctx.prisma, 'FINANCE');
      await ctx.http.post('/v1/auth/otp/request').send({ identifier: staff.email }).expect(202);
      const code = ctx.otp.sent[0]!.code;
      await ctx.http
        .post('/v1/auth/otp/verify')
        .send({ identifier: staff.email, code })
        .expect(200);
      await ctx.http
        .post('/v1/auth/otp/verify')
        .send({ identifier: staff.email, code })
        .expect(401);
    });

    it('accepts only one of two simultaneous logins with the same code', async () => {
      const staff = await createStaff(ctx.prisma, 'FINANCE');
      await ctx.http.post('/v1/auth/otp/request').send({ identifier: staff.email }).expect(202);
      const code = ctx.otp.sent[0]!.code;
      const results = await Promise.all(
        [1, 2, 3].map(() =>
          request(ctx.app.getHttpServer())
            .post('/v1/auth/otp/verify')
            .send({ identifier: staff.email, code }),
        ),
      );
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    });

    it('makes an older code stop working once a new one is requested', async () => {
      const staff = await createStaff(ctx.prisma, 'FINANCE');
      await ctx.http.post('/v1/auth/otp/request').send({ identifier: staff.email }).expect(202);
      const first = ctx.otp.sent[0]!.code;
      await ctx.http.post('/v1/auth/otp/request').send({ identifier: staff.email }).expect(202);
      const second = ctx.otp.sent[1]!.code;
      if (first !== second) {
        await ctx.http
          .post('/v1/auth/otp/verify')
          .send({ identifier: staff.email, code: first })
          .expect(401);
      }
      await ctx.http
        .post('/v1/auth/otp/verify')
        .send({ identifier: staff.email, code: second })
        .expect(200);
    });

    it('rejects an expired code', async () => {
      const staff = await createStaff(ctx.prisma, 'FINANCE');
      await ctx.http.post('/v1/auth/otp/request').send({ identifier: staff.email }).expect(202);
      await ctx.prisma.otpChallenge.updateMany({
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      await ctx.http
        .post('/v1/auth/otp/verify')
        .send({ identifier: staff.email, code: ctx.otp.sent[0]!.code })
        .expect(401);
    });

    it('refuses admin-panel sign-in for field roles, who use the Field App instead', async () => {
      for (const role of ['FIELD_AGENT', 'TECHNICIAN', 'RECOVERY'] as const) {
        const staff = await createStaff(ctx.prisma, role);
        await ctx.http.post('/v1/auth/otp/request').send({ identifier: staff.email }).expect(202);
        const code = ctx.otp.lastCodeFor(staff.email!)!;
        const res = await ctx.http
          .post('/v1/auth/otp/verify')
          .set('X-Client', 'web')
          .send({ identifier: staff.email, code })
          .expect(403);
        expect(res.body.message).toMatch(/Field App/);
        // The code is used up, so it cannot be replayed from the app either.
        await ctx.http
          .post('/v1/auth/otp/verify')
          .send({ identifier: staff.email, code })
          .expect(401);
        // A fresh code works from the app.
        await login(ctx, staff.email!);
      }
    });

    it('refuses a code for a staff member deactivated after it was sent', async () => {
      const staff = await createStaff(ctx.prisma, 'FINANCE');
      await ctx.http.post('/v1/auth/otp/request').send({ identifier: staff.email }).expect(202);
      await ctx.prisma.staffUser.update({
        where: { id: staff.id },
        data: { status: 'DEACTIVATED' },
      });
      await ctx.http
        .post('/v1/auth/otp/verify')
        .send({ identifier: staff.email, code: ctx.otp.sent[0]!.code })
        .expect(401);
    });
  });

  describe('sessions', () => {
    it('protects routes: no token, a bad token or a tampered token gets 401', async () => {
      await ctx.http.get('/v1/auth/me').expect(401);
      await ctx.http.get('/v1/auth/me').set(bearer('nonsense')).expect(401);
      const staff = await createStaff(ctx.prisma, 'FINANCE');
      const { accessToken } = await login(ctx, staff.email!);
      const [h, p, s] = accessToken.split('.');
      const claims = JSON.parse(Buffer.from(p!, 'base64url').toString());
      const forged = Buffer.from(JSON.stringify({ ...claims, role: 'SUPER_ADMIN' })).toString(
        'base64url',
      );
      await ctx.http
        .get('/v1/auth/me')
        .set(bearer(`${h}.${forged}.${s}`))
        .expect(401);
    });

    it('returns the current staff member at /auth/me', async () => {
      const staff = await createStaff(ctx.prisma, 'SUPPORT');
      const { accessToken } = await login(ctx, staff.email!);
      const res = await ctx.http.get('/v1/auth/me').set(bearer(accessToken)).expect(200);
      expect(res.body.staff.id).toBe(staff.id);
      expect(res.body.permissions).toContain('tickets.manage');
    });

    it('rotates refresh tokens for app clients and ends the family if an old one is reused', async () => {
      const staff = await createStaff(ctx.prisma, 'TECHNICIAN');
      const first = await login(ctx, staff.email!);
      const r1 = await ctx.http
        .post('/v1/auth/refresh')
        .send({ refreshToken: first.refreshToken })
        .expect(200);
      expect(r1.body.refreshToken).not.toBe(first.refreshToken);

      // Someone replays the first (already used) token: every session in the family ends.
      await ctx.http
        .post('/v1/auth/refresh')
        .send({ refreshToken: first.refreshToken })
        .expect(401);
      await ctx.http
        .post('/v1/auth/refresh')
        .send({ refreshToken: r1.body.refreshToken })
        .expect(401);
      await ctx.http.get('/v1/auth/me').set(bearer(r1.body.accessToken)).expect(401);
      expect(
        await ctx.prisma.auditLog.count({ where: { action: 'auth.refresh_token_reused' } }),
      ).toBe(1);
    });

    it('gives web clients an httpOnly cookie instead of a refresh token in the body', async () => {
      const staff = await createStaff(ctx.prisma, 'SUPER_ADMIN');
      const web = await login(ctx, staff.email!, { web: true });
      expect(web.body.refreshToken).toBeUndefined();
      expect(web.cookie).toMatch(/^vn_refresh=/);

      const res = await ctx.http
        .post('/v1/auth/refresh')
        .set('X-Client', 'web')
        .set('Cookie', web.cookie!)
        .expect(200);
      const cookie = (res.headers['set-cookie'] as unknown as string[])[0]!;
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/SameSite=Strict/i);
      expect(cookie).toMatch(/Path=\/v1\/auth/);
      expect(res.body.refreshToken).toBeUndefined();
    });

    it('ends an admin panel session after 30 minutes without activity', async () => {
      const staff = await createStaff(ctx.prisma, 'FINANCE');
      const s = await login(ctx, staff.email!, { web: true });
      await ctx.prisma.staffSession.updateMany({
        data: { lastUsedAt: new Date(Date.now() - 31 * 60_000) },
      });
      await ctx.http
        .post('/v1/auth/refresh')
        .set('X-Client', 'web')
        .set('Cookie', s.cookie!)
        .send({})
        .expect(401);
      const row = await ctx.prisma.staffSession.findFirstOrThrow({ where: { staffId: staff.id } });
      expect(row.revokedReason).toBe('idle_timeout');
    });

    it('ends a session at its absolute limit, however active', async () => {
      const staff = await createStaff(ctx.prisma, 'FINANCE');
      const s = await login(ctx, staff.email!);
      await ctx.prisma.staffSession.updateMany({
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      await ctx.http.post('/v1/auth/refresh').send({ refreshToken: s.refreshToken }).expect(401);
    });

    it('keeps the original absolute limit across refreshes', async () => {
      const staff = await createStaff(ctx.prisma, 'FINANCE');
      const s = await login(ctx, staff.email!);
      const original = await ctx.prisma.staffSession.findFirstOrThrow({
        where: { staffId: staff.id },
      });
      await ctx.http.post('/v1/auth/refresh').send({ refreshToken: s.refreshToken }).expect(200);
      const rotated = await ctx.prisma.staffSession.findFirstOrThrow({
        where: { staffId: staff.id, rotatedAt: null },
      });
      expect(rotated.expiresAt.getTime()).toBe(original.expiresAt.getTime());
    });

    it('logs out immediately: the access token stops working before it expires', async () => {
      const staff = await createStaff(ctx.prisma, 'FINANCE');
      const s = await login(ctx, staff.email!);
      await ctx.http.post('/v1/auth/logout').set(bearer(s.accessToken)).expect(204);
      await ctx.http.get('/v1/auth/me').set(bearer(s.accessToken)).expect(401);
      await ctx.http.post('/v1/auth/refresh').send({ refreshToken: s.refreshToken }).expect(401);
    });

    it('stops a deactivated staff member at once, without waiting for the token to expire', async () => {
      const staff = await createStaff(ctx.prisma, 'FINANCE');
      const s = await login(ctx, staff.email!);
      await ctx.prisma.staffUser.update({
        where: { id: staff.id },
        data: { status: 'DEACTIVATED' },
      });
      await ctx.http.get('/v1/auth/me').set(bearer(s.accessToken)).expect(401);
      await ctx.http.post('/v1/auth/refresh').send({ refreshToken: s.refreshToken }).expect(401);
    });

    it('stores only hashes of refresh tokens', async () => {
      const staff = await createStaff(ctx.prisma, 'FINANCE');
      const s = await login(ctx, staff.email!);
      const row = await ctx.prisma.staffSession.findFirstOrThrow({ where: { staffId: staff.id } });
      expect(row.refreshTokenHash).toBe(createHash('sha256').update(s.refreshToken!).digest('hex'));
    });
  });
});

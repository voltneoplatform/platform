import request from 'supertest';
import {
  DRIVER_CODE_SENDER,
  type MemoryDriverCodeSender,
} from '../src/driver-auth/driver-code-sender';
import { bearer, createTestApp, loginAs, resetData, type TestContext } from './helpers';
import {
  NOT_A_DOC,
  PDF,
  PNG,
  activeAgreement,
  bareActivePlan,
  confirmPhone,
  makeDriver,
  readyDriver,
  uploadKyc,
} from './fixtures';

describe('Drivers, vehicles and KYC (module 5)', () => {
  let ctx: TestContext;
  let ops: Awaited<ReturnType<typeof loginAs>>;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  beforeEach(async () => {
    await resetData(ctx.prisma);
    ops = await loginAs(ctx, 'OPERATIONS_MANAGER');
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  describe('registering drivers', () => {
    it('registers a driver with vehicle and nominee, normalising phone and registration', async () => {
      const phoneCheckId = await confirmPhone(ctx, ops.token, '9830011111');
      const res = await ctx.http
        .post('/v1/drivers')
        .set(bearer(ops.token))
        .send({
          name: 'Ramesh Das',
          phone: '098300 11111',
          phoneCheckId,
          language: 'BN',
          dateOfBirth: '1985-03-02',
          relativeRelation: 'SON_OF',
          relativeName: 'Haren Das',
          email: 'Ramesh@Example.COM',
          addressLine: '4 Ghat Road',
          area: 'Baruipur',
          district: 'South 24 Parganas',
          pinCode: '743610',
          nomineeName: 'Mita Das',
          nomineeRelation: 'Wife',
          nomineePhone: '9123456789',
          vehicle: { registration: 'wb-19 ab 1234', type: 'TOTO', ownedByDriver: true },
        })
        .expect(201);
      expect(res.body).toMatchObject({
        phone: '+919830011111',
        state: 'West Bengal',
        nominee: { name: 'Mita Das', phone: '+919123456789' },
        relative: { relation: 'SON_OF', name: 'Haren Das' },
        email: 'ramesh@example.com',
        vehicle: { registration: 'WB19AB1234', type: 'TOTO', ownedByDriver: true },
      });
      expect(res.body.readiness.ready).toBe(false);
      expect(
        res.body.readiness.items
          .filter((i: { done: boolean }) => i.done)
          .map((i: { item: string }) => i.item),
      ).toEqual([
        'PHONE_VERIFIED',
        'ADULT',
        'VEHICLE_RECORDED',
        'OWNER_CONSENT',
        'NOMINEE_RECORDED',
      ]);
      expect(res.body.onboarding).toMatchObject({
        stage: 'PAPERWORK',
        approval: 'AWAITING',
        consentVersion: 'reg-consent-v1',
        registeredAt: null,
      });
      expect(res.body.onboarding.phoneVerifiedAt).not.toBeNull();
    });

    it("needs both the relation and the father's or husband's name, or neither", async () => {
      const phoneCheckId = await confirmPhone(ctx, ops.token, '9830022222');
      const send = (extra: Record<string, unknown>) =>
        ctx.http
          .post('/v1/drivers')
          .set(bearer(ops.token))
          .send({
            name: 'Anil Roy',
            phone: '9830022222',
            phoneCheckId,
            language: 'BN',
            dateOfBirth: '1988-05-05',
            addressLine: '1 Bazar Road',
            district: 'South 24 Parganas',
            pinCode: '743610',
            vehicle: { registration: 'WB 19 C 4321', type: 'TOTO', ownedByDriver: true },
            ...extra,
          });
      await send({ relativeRelation: 'SON_OF' }).expect(400);
      await send({ relativeName: 'Bimal Roy' }).expect(400);
      await send({ relativeRelation: 'BROTHER_OF', relativeName: 'Bimal Roy' }).expect(400);
      const d = (await send({}).expect(201)).body;
      expect(d.relative).toBeNull();
      await ctx.http
        .patch(`/v1/drivers/${d.id}`)
        .set(bearer(ops.token))
        .send({ relativeName: 'Bimal Roy' })
        .expect(400);
      const updated = await ctx.http
        .patch(`/v1/drivers/${d.id}`)
        .set(bearer(ops.token))
        .send({ relativeRelation: 'SON_OF', relativeName: 'Bimal Roy' })
        .expect(200);
      expect(updated.body.relative).toEqual({ relation: 'SON_OF', name: 'Bimal Roy' });
    });

    it('flags a phone number already on another driver, and saves only when confirmed', async () => {
      const first = await makeDriver(ctx, ops.token);
      const body = {
        name: 'Second Driver',
        phone: first.phone,
        phoneCheckId: await confirmPhone(ctx, ops.token, first.phone),
        language: 'HI',
        addressLine: '1 Main Road',
        district: 'Kolkata',
        pinCode: '700001',
      };
      const res = await ctx.http.post('/v1/drivers').set(bearer(ops.token)).send(body).expect(409);
      expect(res.body.code).toBe('POSSIBLE_DUPLICATE');
      expect(res.body.duplicates[0]).toMatchObject({ kind: 'phone', driverId: first.id });
      const ok = await ctx.http
        .post('/v1/drivers')
        .set(bearer(ops.token))
        .send({ ...body, acknowledgeDuplicates: true })
        .expect(201);
      expect(ok.body.duplicates[0]).toMatchObject({ kind: 'phone', driverId: first.id });
      const audit = await ctx.prisma.auditLog.findFirstOrThrow({
        where: { action: 'driver.create', recordId: ok.body.id },
      });
      expect(JSON.stringify(audit.after)).toContain('duplicatesAcknowledged');
    });

    it('flags a vehicle already recorded for another driver', async () => {
      await makeDriver(ctx, ops.token, {
        vehicle: { registration: 'WB19 Z 0001', type: 'TOTO', ownedByDriver: true },
      });
      const res = await ctx.http
        .post('/v1/drivers')
        .set(bearer(ops.token))
        .send({
          name: 'Night Shift',
          phone: '9000000001',
          language: 'BN',
          addressLine: 'x road',
          district: 'Kolkata',
          pinCode: '700001',
          vehicle: {
            registration: 'wb-19-z-0001',
            type: 'TOTO',
            ownedByDriver: false,
            ownerName: 'Owner',
            ownerPhone: '9000000002',
          },
        })
        .expect(409);
      expect(res.body.duplicates[0].kind).toBe('registration');
    });

    it('refuses drivers under 18, bad phones and renters without owner details', async () => {
      const base = {
        name: 'Young',
        phone: '9000000003',
        language: 'BN',
        addressLine: 'x road',
        district: 'Kolkata',
        pinCode: '700001',
      };
      const young = await ctx.http
        .post('/v1/drivers')
        .set(bearer(ops.token))
        .send({ ...base, dateOfBirth: '2015-01-01' })
        .expect(400);
      expect(young.body.message).toMatch(/18/);
      await ctx.http
        .post('/v1/drivers')
        .set(bearer(ops.token))
        .send({ ...base, phone: '12345' })
        .expect(400);
      const renter = await ctx.http
        .post('/v1/drivers')
        .set(bearer(ops.token))
        .send({ ...base, vehicle: { registration: 'WB1', type: 'TOTO', ownedByDriver: false } })
        .expect(400);
      expect(renter.body.message).toMatch(/owner/);
      await ctx.http
        .post('/v1/drivers')
        .set(bearer(ops.token))
        .send({ ...base, vehicle: { type: 'TOTO', ownedByDriver: true } })
        .expect(400);
    });

    it('lets field agents register drivers but support only read them', async () => {
      const agent = await loginAs(ctx, 'FIELD_AGENT');
      const d = await makeDriver(ctx, agent.token);
      const support = await loginAs(ctx, 'SUPPORT');
      await ctx.http.get(`/v1/drivers/${d.id}`).set(bearer(support.token)).expect(200);
      await ctx.http
        .patch(`/v1/drivers/${d.id}`)
        .set(bearer(support.token))
        .send({ name: 'Changed' })
        .expect(403);
    });

    it('lists and searches drivers by name, phone or vehicle', async () => {
      await makeDriver(ctx, ops.token, {
        name: 'Sanjay Mondal',
        vehicle: { registration: 'WB 20 Q 7777', type: 'E_RICKSHAW', ownedByDriver: true },
      });
      await makeDriver(ctx, ops.token, { name: 'Abdul Karim' });
      const byName = await ctx.http
        .get('/v1/drivers?search=sanjay')
        .set(bearer(ops.token))
        .expect(200);
      expect(byName.body.items.map((d: { name: string }) => d.name)).toEqual(['Sanjay Mondal']);
      const byReg = await ctx.http
        .get('/v1/drivers?search=wb20q7777')
        .set(bearer(ops.token))
        .expect(200);
      expect(byReg.body.total).toBe(1);
      const notReady = await ctx.http
        .get('/v1/drivers?readiness=not_ready')
        .set(bearer(ops.token))
        .expect(200);
      expect(notReady.body.total).toBe(2);
    });
  });

  describe('KYC documents', () => {
    it('encrypts ID numbers, shows them masked, and stores no plain number anywhere', async () => {
      const d = await makeDriver(ctx, ops.token);
      const res = await uploadKyc(ctx, ops.token, d.id, {
        type: 'VOTER_ID',
        number: 'wbx 1234567',
        usedForAddress: 'true',
      }).expect(201);
      const doc = res.body.documents[0];
      expect(doc).toMatchObject({
        type: 'VOTER_ID',
        maskedNumber: '••••4567',
        usedForAddress: true,
        status: 'PENDING',
      });
      const row = await ctx.prisma.kycDocument.findUniqueOrThrow({ where: { id: doc.id } });
      expect(row.numberEncrypted).toMatch(/^v1:/);
      expect(row.numberEncrypted).not.toContain('1234567');
      const audit = JSON.stringify(
        await ctx.prisma.auditLog.findMany({ where: { tableName: 'kyc_documents' } }),
        (_k, v) => (typeof v === 'bigint' ? String(v) : v),
      );
      expect(audit).not.toContain('WBX1234567');
    });

    it('keeps only the last 4 digits of an Aadhaar number (until legal item L7 is answered)', async () => {
      const d = await makeDriver(ctx, ops.token);
      const res = await uploadKyc(ctx, ops.token, d.id, {
        type: 'AADHAAR',
        number: '2345 6789 0123',
      }).expect(201);
      expect(res.body.documents[0]).toMatchObject({
        maskedNumber: 'XXXX XXXX 0123',
        fullNumberStored: false,
      });
      const row = await ctx.prisma.kycDocument.findFirstOrThrow({ where: { driverId: d.id } });
      expect(row.numberEncrypted).toBeNull();
      const reveal = await ctx.http
        .post(`/v1/kyc-documents/${row.id}/reveal`)
        .set(bearer(ops.token))
        .expect(409);
      expect(reveal.body.message).toMatch(/last 4 digits/);
      await expect(
        ctx.prisma.$executeRawUnsafe(
          `UPDATE "kyc_documents" SET "number_encrypted" = 'v1:x' WHERE id = '${row.id}'`,
        ),
      ).rejects.toThrow(/kyc_documents_no_full_aadhaar/);
    });

    it('flags the same ID on another driver, and refuses it twice on the same driver', async () => {
      const a = await makeDriver(ctx, ops.token);
      const b = await makeDriver(ctx, ops.token);
      await uploadKyc(ctx, ops.token, a.id, { type: 'PAN', number: 'ABCDE1234F' }).expect(201);
      await uploadKyc(ctx, ops.token, a.id, { type: 'PAN', number: 'abcde1234f' }).expect(409);
      const dup = await uploadKyc(ctx, ops.token, b.id, {
        type: 'PAN',
        number: 'ABCDE 1234 F',
      }).expect(409);
      expect(dup.body.duplicates[0]).toMatchObject({
        kind: 'document',
        driverId: a.id,
        detail: 'Same PAN card (••••234F)',
      });
      await uploadKyc(ctx, ops.token, b.id, {
        type: 'PAN',
        number: 'ABCDE1234F',
        acknowledgeDuplicates: 'true',
      }).expect(201);
      const profile = await ctx.http.get(`/v1/drivers/${a.id}`).set(bearer(ops.token)).expect(200);
      expect(profile.body.duplicates).toEqual([
        expect.objectContaining({ kind: 'document', driverId: b.id }),
      ]);
    });

    it('checks the file by its content and the number by its format', async () => {
      const d = await makeDriver(ctx, ops.token);
      const bad = await uploadKyc(
        ctx,
        ops.token,
        d.id,
        { type: 'DRIVER_PHOTO' },
        NOT_A_DOC,
        'photo.png',
      ).expect(400);
      expect(bad.body.message).toMatch(/JPEG, PNG, WebP/);
      const num = await uploadKyc(ctx, ops.token, d.id, { type: 'PAN', number: '12345' }).expect(
        400,
      );
      expect(num.body.message).toMatch(/PAN card number looks wrong/);
      await ctx.http
        .post(`/v1/drivers/${d.id}/kyc`)
        .set(bearer(ops.token))
        .field('type', 'DRIVER_PHOTO')
        .expect(400);
      const pan = await uploadKyc(ctx, ops.token, d.id, {
        type: 'PAN',
        number: 'ABCDE1234F',
        usedForAddress: 'true',
      }).expect(400);
      expect(pan.body.message).toMatch(/cannot be used as proof of address/);
      await uploadKyc(
        ctx,
        ops.token,
        d.id,
        { type: 'DRIVING_LICENCE', number: 'WB-0120190012345' },
        PDF,
        'dl.pdf',
      ).expect(201);
    });

    it('logs every view: full number reveal and short-lived file links', async () => {
      const d = await makeDriver(ctx, ops.token);
      const res = await uploadKyc(ctx, ops.token, d.id, {
        type: 'DRIVING_LICENCE',
        number: 'WB0120190012345',
      }).expect(201);
      const id = res.body.documents[0].id;
      const reveal = await ctx.http
        .post(`/v1/kyc-documents/${id}/reveal`)
        .set(bearer(ops.token))
        .expect(200);
      expect(reveal.body.number).toBe('WB0120190012345');
      const link = await ctx.http
        .post(`/v1/kyc-documents/${id}/link`)
        .set(bearer(ops.token))
        .expect(200);
      expect(link.body.url).toMatch(/^\/v1\/files\//);
      const file = await request(ctx.app.getHttpServer())
        .get(link.body.url)
        .buffer(true)
        .parse((r, cb) => {
          const chunks: Buffer[] = [];
          r.on('data', (c: Buffer) => chunks.push(c));
          r.on('end', () => cb(null, Buffer.concat(chunks)));
        })
        .expect(200);
      expect(file.headers['content-type']).toBe('image/png');
      expect(file.headers['cache-control']).toMatch(/no-store/);
      expect(Buffer.compare(file.body as Buffer, PNG)).toBe(0);
      const actions = (await ctx.prisma.auditLog.findMany({ where: { recordId: id } })).map(
        (a) => a.action,
      );
      expect(actions).toEqual(
        expect.arrayContaining(['kyc.upload', 'kyc.number_revealed', 'kyc.document_viewed']),
      );
    });

    it('refuses tampered or expired file links', async () => {
      const d = await makeDriver(ctx, ops.token);
      const res = await uploadKyc(ctx, ops.token, d.id, { type: 'DRIVER_PHOTO' }).expect(201);
      const link = await ctx.http
        .post(`/v1/kyc-documents/${res.body.documents[0].id}/link`)
        .set(bearer(ops.token))
        .expect(200);
      const [body, sig] = link.body.url.replace('/v1/files/', '').split('.');
      const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
      const expired = Buffer.from(JSON.stringify({ ...payload, e: 1 })).toString('base64url');
      await ctx.http.get(`/v1/files/${expired}.${sig}`).expect(404);
      const otherKey = Buffer.from(
        JSON.stringify({ ...payload, k: 'kyc/x/00000000-0000-0000-0000-000000000000.png' }),
      ).toString('base64url');
      await ctx.http.get(`/v1/files/${otherKey}.${sig}`).expect(404);
    });

    it('stops support and field agents seeing full numbers or files, and only verifiers can verify', async () => {
      const agent = await loginAs(ctx, 'FIELD_AGENT');
      const d = await makeDriver(ctx, agent.token);
      const res = await uploadKyc(ctx, agent.token, d.id, {
        type: 'PAN',
        number: 'ABCDE1234F',
      }).expect(201);
      const id = res.body.documents[0].id;
      const support = await loginAs(ctx, 'SUPPORT');
      for (const token of [agent.token, support.token]) {
        await ctx.http.post(`/v1/kyc-documents/${id}/reveal`).set(bearer(token)).expect(403);
        await ctx.http.post(`/v1/kyc-documents/${id}/link`).set(bearer(token)).expect(403);
        await ctx.http.post(`/v1/kyc-documents/${id}/verify`).set(bearer(token)).expect(403);
      }
      const pm = await loginAs(ctx, 'PLAN_MANAGER');
      await ctx.http.post(`/v1/kyc-documents/${id}/verify`).set(bearer(pm.token)).expect(403);
      await ctx.http.post(`/v1/kyc-documents/${id}/verify`).set(bearer(ops.token)).expect(200);
    });
  });

  describe('readiness for an agreement', () => {
    it('shows the agreement in progress instead of "ready", and leaves those drivers out of the ready filter', async () => {
      const pm = await loginAs(ctx, 'PLAN_MANAGER');
      const finance = await loginAs(ctx, 'FINANCE');
      const a = await activeAgreement(ctx, {
        ops: ops.token,
        finance: finance.token,
        pm: pm.token,
      });
      const waiting = await readyDriver(ctx, ops.token);

      const list = await ctx.http.get('/v1/drivers').set(bearer(ops.token)).expect(200);
      const signed = list.body.items.find((x: { phone: string }) => x.phone === a.driverPhone);
      expect(signed).toMatchObject({
        ready: true,
        agreement: { id: a.id, number: a.number, state: 'ACTIVE' },
      });
      expect(list.body.items.find((x: { id: string }) => x.id === waiting.id).agreement).toBeNull();

      const ready = await ctx.http
        .get('/v1/drivers?readiness=ready')
        .set(bearer(ops.token))
        .expect(200);
      expect(ready.body.items.map((x: { id: string }) => x.id)).toEqual([waiting.id]);
    });

    it('becomes ready once identity, PAN, address and photo are verified and the renter has owner consent', async () => {
      const d = await makeDriver(ctx, ops.token, {
        planId: await bareActivePlan(ctx),
        vehicle: {
          registration: 'WB 19 R 5555',
          type: 'E_RICKSHAW',
          ownedByDriver: false,
          ownerName: 'Gopal Saha',
          ownerPhone: '9800000000',
        },
      });
      await uploadKyc(ctx, ops.token, d.id, {
        type: 'VOTER_ID',
        number: 'ABC1234567',
        usedForAddress: 'true',
      }).expect(201);
      let profile = (await uploadKyc(ctx, ops.token, d.id, { type: 'DRIVER_PHOTO' }).expect(201))
        .body;
      for (const doc of profile.documents) {
        profile = (
          await ctx.http
            .post(`/v1/kyc-documents/${doc.id}/verify`)
            .set(bearer(ops.token))
            .expect(200)
        ).body;
      }
      const panItem = () =>
        profile.readiness.items.find((i: { item: string }) => i.item === 'PAN_VERIFIED');
      expect(panItem()).toMatchObject({ applies: true, done: false });
      profile = (
        await uploadKyc(ctx, ops.token, d.id, { type: 'PAN', number: 'ABCDE1234F' }).expect(201)
      ).body;
      const pan = profile.documents.find((x: { type: string }) => x.type === 'PAN');
      profile = (
        await ctx.http.post(`/v1/kyc-documents/${pan.id}/verify`).set(bearer(ops.token)).expect(200)
      ).body;
      expect(panItem()).toMatchObject({ done: true });
      expect(profile.readiness.ready).toBe(false);
      expect(
        profile.readiness.items.find((i: { item: string }) => i.item === 'OWNER_CONSENT'),
      ).toMatchObject({ applies: true, done: false });

      const consent = await ctx.http
        .post(`/v1/drivers/${d.id}/vehicle/owner-consent`)
        .set(bearer(ops.token))
        .attach('file', PDF, 'owner-consent.pdf')
        .expect(201);
      expect(consent.body.vehicle.ownerConsent).toMatchObject({
        fileName: 'owner-consent.pdf',
        fileType: 'application/pdf',
      });
      expect(consent.body.readiness.ready).toBe(true);

      const list = await ctx.http
        .get('/v1/drivers?readiness=ready')
        .set(bearer(ops.token))
        .expect(200);
      expect(list.body.items.map((x: { id: string }) => x.id)).toEqual([d.id]);
    });

    it('drops readiness when a verified document is later rejected', async () => {
      const d = await makeDriver(ctx, ops.token);
      const up = await uploadKyc(ctx, ops.token, d.id, {
        type: 'VOTER_ID',
        number: 'ABC7654321',
        usedForAddress: 'true',
      }).expect(201);
      const photo = await uploadKyc(ctx, ops.token, d.id, { type: 'DRIVER_PHOTO' }).expect(201);
      for (const doc of photo.body.documents)
        await ctx.http
          .post(`/v1/kyc-documents/${doc.id}/verify`)
          .set(bearer(ops.token))
          .expect(200);
      const id = up.body.documents[0].id;
      await ctx.http.post(`/v1/kyc-documents/${id}/verify`).set(bearer(ops.token)).expect(409);
      const rejected = await ctx.http
        .post(`/v1/kyc-documents/${id}/reject`)
        .set(bearer(ops.token))
        .send({ reason: 'Photo does not match' })
        .expect(200);
      expect(rejected.body.readiness.ready).toBe(false);
      expect(rejected.body.documents.find((x: { id: string }) => x.id === id)).toMatchObject({
        status: 'REJECTED',
        rejectionReason: 'Photo does not match',
      });
    });

    it('keeps the previous vehicle as history when the driver changes vehicle', async () => {
      const d = await makeDriver(ctx, ops.token);
      const res = await ctx.http
        .put(`/v1/drivers/${d.id}/vehicle`)
        .set(bearer(ops.token))
        .send({ chassisNumber: 'MA1TA2B3C4D', type: 'E_THREE_WHEELER', ownedByDriver: true })
        .expect(200);
      expect(res.body.vehicle).toMatchObject({
        registration: null,
        chassisNumber: 'MA1TA2B3C4D',
        type: 'E_THREE_WHEELER',
      });
      expect(res.body.previousVehicles).toHaveLength(1);
      await ctx.http
        .post(`/v1/drivers/${d.id}/vehicle/owner-consent`)
        .set(bearer(ops.token))
        .attach('file', PDF, 'c.pdf')
        .expect(409);
    });
  });

  describe('onboarding (founder, 1 Nov 2026)', () => {
    const body = (phone: string, extra: Record<string, unknown> = {}) => ({
      name: 'Kartik Pal',
      phone,
      language: 'BN',
      dateOfBirth: '1991-02-02',
      addressLine: '3 Hat Road',
      district: 'South 24 Parganas',
      pinCode: '743610',
      vehicle: { registration: 'WB 19 K 2468', type: 'TOTO', ownedByDriver: true },
      ...extra,
    });

    it('saves a driver only after they give the code sent to their phone', async () => {
      const agent = await loginAs(ctx, 'FIELD_AGENT');
      const location = { lat: 22.36, lng: 88.43, accuracyM: 9 };
      const none = await ctx.http
        .post('/v1/drivers')
        .set(bearer(agent.token))
        .send(body('9830055555', { location }))
        .expect(422);
      expect(none.body.code).toBe('PHONE_NOT_CONFIRMED');

      const sent = await ctx.http
        .post('/v1/drivers/phone-codes')
        .set(bearer(agent.token))
        .send({ phone: '98300 55555', language: 'BN', name: 'Kartik Pal' })
        .expect(201);
      expect(sent.body).toMatchObject({ phone: '+919830055555', expiresInSeconds: 600 });
      const confirm = (code: string, token = agent.token) =>
        ctx.http
          .post('/v1/drivers/phone-codes/confirm')
          .set(bearer(token))
          .send({ checkId: sent.body.checkId, code });
      const code = ctx.app
        .get<MemoryDriverCodeSender>(DRIVER_CODE_SENDER)
        .lastCodeFor('+919830055555')!;
      await confirm(code === '000000' ? '111111' : '000000').expect(422);
      // Only the staff member who sent it can use it.
      await confirm(code, ops.token).expect(422);
      await confirm(code).expect(200);

      // A different number cannot use this check.
      await ctx.http
        .post('/v1/drivers')
        .set(bearer(agent.token))
        .send(body('9830066666', { location, phoneCheckId: sent.body.checkId }))
        .expect(422);
      // From the Field App, the location is needed too.
      expect(
        (
          await ctx.http
            .post('/v1/drivers')
            .set(bearer(agent.token))
            .send(body('9830055555', { phoneCheckId: sent.body.checkId }))
            .expect(422)
        ).body.code,
      ).toBe('NO_LOCATION');
      const d = (
        await ctx.http
          .post('/v1/drivers')
          .set(bearer(agent.token))
          .send(body('9830055555', { location, phoneCheckId: sent.body.checkId }))
          .expect(201)
      ).body;
      expect(d.onboarding).toMatchObject({
        registeredAt: location,
        consentVersion: 'reg-consent-v1',
        phoneVerifiedByName: agent.staff.name,
      });
      // A check is used once.
      await ctx.http
        .post('/v1/drivers')
        .set(bearer(agent.token))
        .send(
          body('9830055555', {
            location,
            phoneCheckId: sent.body.checkId,
            acknowledgeDuplicates: true,
            vehicle: undefined,
          }),
        )
        .expect(422);

      // Changing the number needs the driver's code on the new number.
      await ctx.http
        .patch(`/v1/drivers/${d.id}`)
        .set(bearer(agent.token))
        .send({ phone: '9830077777' })
        .expect(422);
      const newCheck = await confirmPhone(ctx, agent.token, '9830077777');
      const changed = await ctx.http
        .patch(`/v1/drivers/${d.id}`)
        .set(bearer(agent.token))
        .send({ phone: '9830077777', phoneCheckId: newCheck })
        .expect(200);
      expect(changed.body.phone).toBe('+919830077777');
    });

    it('is approved by head office once every item is done, on a plan it may change', async () => {
      const agent = await loginAs(ctx, 'FIELD_AGENT');
      const firstPlan = await bareActivePlan(ctx);
      const betterPlan = await bareActivePlan(ctx);
      const d = await readyDriver(ctx, ops.token, { planId: firstPlan });
      const unready = await makeDriver(ctx, ops.token, { planId: firstPlan });

      // The field agent can change the plan before approval, but cannot approve.
      await ctx.http
        .patch(`/v1/drivers/${d.id}`)
        .set(bearer(agent.token))
        .send({ planId: firstPlan })
        .expect(200);
      await ctx.http.post(`/v1/drivers/${d.id}/approve`).set(bearer(agent.token)).expect(403);
      const pm = await loginAs(ctx, 'PLAN_MANAGER');
      expect(
        (await ctx.http.post(`/v1/drivers/${unready.id}/approve`).set(bearer(pm.token)).expect(422))
          .body.code,
      ).toBe('NOT_READY');

      const waiting = await ctx.http
        .get('/v1/drivers?stage=AWAITING_APPROVAL')
        .set(bearer(ops.token))
        .expect(200);
      expect(waiting.body.items.map((x: { id: string }) => x.id)).toEqual([d.id]);

      // Rejected with a reason, fixed, and sent again.
      await ctx.http
        .post(`/v1/drivers/${d.id}/reject`)
        .set(bearer(pm.token))
        .send({ reason: 'no' })
        .expect(400);
      const rejected = await ctx.http
        .post(`/v1/drivers/${d.id}/reject`)
        .set(bearer(pm.token))
        .send({ reason: 'Address proof is an old bill' })
        .expect(200);
      expect(rejected.body.onboarding).toMatchObject({
        stage: 'REJECTED',
        approvalReason: 'Address proof is an old bill',
      });
      const again = await ctx.http
        .post(`/v1/drivers/${d.id}/resubmit`)
        .set(bearer(agent.token))
        .expect(200);
      expect(again.body.onboarding.stage).toBe('AWAITING_APPROVAL');

      // Approved on a different plan.
      const ok = await ctx.http
        .post(`/v1/drivers/${d.id}/approve`)
        .set(bearer(pm.token))
        .send({ planId: betterPlan })
        .expect(200);
      expect(ok.body.onboarding).toMatchObject({
        stage: 'APPROVED',
        approval: 'APPROVED',
        approvedByName: pm.staff.name,
        plan: { id: betterPlan },
      });
      expect(ok.body.onboarding.decisions.map((x: { decision: string }) => x.decision)).toEqual([
        'APPROVED',
        'REJECTED',
      ]);
      // Once approved, only head office changes the plan (by approving again).
      await ctx.http
        .patch(`/v1/drivers/${d.id}`)
        .set(bearer(agent.token))
        .send({ planId: firstPlan })
        .expect(409);
      await expect(
        ctx.prisma.$executeRawUnsafe(
          `UPDATE "driver_approval_decisions" SET "reason" = 'x' WHERE "driver_id" = '${d.id}'`,
        ),
      ).rejects.toThrow();
    });
  });
});

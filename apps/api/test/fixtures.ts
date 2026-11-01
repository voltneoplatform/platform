import zlib from 'node:zlib';
import { rupeesToPaise as r } from '@voltneo/shared';
import {
  DRIVER_CODE_SENDER,
  type MemoryDriverCodeSender,
} from '../src/driver-auth/driver-code-sender';
import { bearer, type TestContext } from './helpers';

export const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('test image body'),
]);
export const PDF = Buffer.from('%PDF-1.4\n% test consent form\n');
export const NOT_A_DOC = Buffer.from('MZ this is not an image');

/** A real, decodable PNG (a white page of the given size), for code that reads images. */
export function realPng(width = 40, height = 56): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0xff)]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

let n = 0;

export async function makeBatteryType(
  ctx: TestContext,
  token: string,
  opts: { purchase?: number; allowances?: number; name?: string } = {},
) {
  n += 1;
  const res = await ctx.http
    .post('/v1/battery-types')
    .set(bearer(token))
    .send({
      name: opts.name ?? `Neo ${48 + n}`,
      voltage: 51.2,
      capacityAh: 105,
      chemistry: 'LFP (lithium iron phosphate)',
      supplier: 'Test Supplier Pvt Ltd',
      warrantyMonths: 36,
      compatibleVehicles: ['TOTO', 'E_RICKSHAW'],
      cost: {
        purchaseCost: r(opts.purchase ?? 50000),
        gpsCost: r(opts.allowances ?? 0),
      },
    })
    .expect(201);
  return res.body as { id: string; name: string; currentCost: { costFloor: number } };
}

export async function makePlan(ctx: TestContext, token: string, en?: string) {
  n += 1;
  const res = await ctx.http
    .post('/v1/plans')
    .set(bearer(token))
    .send({ nameBn: `সহজ ${n}`, nameHi: `आसान ${n}`, nameEn: en ?? `Easy Start ${n}` })
    .expect(201);
  return res.body as {
    id: string;
    code: string;
    versions: { id: string; version: number; status: string }[];
  };
}

/**
 * The registration code check (founder, 1 Nov 2026): sends a code to the phone,
 * reads it from the in-memory sender as the driver would read it out, and
 * confirms it. Returns the check id to save the driver with.
 */
export async function confirmPhone(ctx: TestContext, token: string, phone: string) {
  const sent = await ctx.http
    .post('/v1/drivers/phone-codes')
    .set(bearer(token))
    .send({ phone, language: 'BN' })
    .expect(201);
  const sender = ctx.app.get<MemoryDriverCodeSender>(DRIVER_CODE_SENDER);
  const code = sender.lastCodeFor(sent.body.phone);
  if (!code) throw new Error(`no registration code for ${phone}`);
  await ctx.http
    .post('/v1/drivers/phone-codes/confirm')
    .set(bearer(token))
    .send({ checkId: sent.body.checkId, code })
    .expect(200);
  return sent.body.checkId as string;
}

/** An active plan with a published version, made directly (for readiness only, no prices). */
export async function bareActivePlan(ctx: TestContext) {
  n += 1;
  const plan = await ctx.prisma.plan.create({
    data: {
      seq: 900000 + n,
      code: `TP${n}`,
      nameBn: `পরীক্ষা ${n}`,
      nameHi: `परीक्षा ${n}`,
      nameEn: `Test plan ${n}`,
      status: 'ACTIVE',
      versions: {
        create: {
          version: 1,
          status: 'PUBLISHED',
          termMonths: 18,
          graceDays: 5,
          lateFeePerDayPaise: 10000,
          lateFeeCapDays: 30,
          publishedAt: new Date(),
        },
      },
    },
  });
  return plan.id;
}

export async function makeDriver(
  ctx: TestContext,
  token: string,
  overrides: Record<string, unknown> = {},
) {
  n += 1;
  const phone =
    (overrides.phone as string | undefined) ?? `98${String(30000000 + n).padStart(8, '0')}`;
  const phoneCheckId =
    'phoneCheckId' in overrides ? overrides.phoneCheckId : await confirmPhone(ctx, token, phone);
  const res = await ctx.http
    .post('/v1/drivers')
    .set(bearer(token))
    .send({
      name: `Driver ${n}`,
      phone,
      phoneCheckId,
      // Where the Field App registered the driver (needed from field staff).
      location: { lat: 22.5726, lng: 88.3639, accuracyM: 12 },
      language: 'BN',
      dateOfBirth: '1990-01-15',
      addressLine: '12 Station Road',
      district: 'South 24 Parganas',
      pinCode: '743329',
      nomineeName: 'Sita Das',
      nomineeRelation: 'Wife',
      nomineePhone: '9123400000',
      vehicle: { registration: `WB 19 X ${1000 + n}`, type: 'TOTO', ownedByDriver: true },
      ...overrides,
    })
    .expect(201);
  return res.body as { id: string; phone: string; readiness: { ready: boolean } };
}

export function uploadKyc(
  ctx: TestContext,
  token: string,
  driverId: string,
  fields: Record<string, string>,
  file: Buffer = PNG,
  filename = 'doc.png',
) {
  const req = ctx.http.post(`/v1/drivers/${driverId}/kyc`).set(bearer(token));
  for (const [k, v] of Object.entries(fields)) req.field(k, v);
  return req.attach('file', file, filename);
}

/**
 * A driver whose readiness checklist is complete: phone confirmed by code, a
 * plan chosen (a bare test plan unless one is given), identity, PAN, address
 * and photo verified.
 */
export async function readyDriver(
  ctx: TestContext,
  opsToken: string,
  overrides: Record<string, unknown> = {},
) {
  const planId = (overrides.planId as string | undefined) ?? (await bareActivePlan(ctx));
  const d = await makeDriver(ctx, opsToken, { ...overrides, planId });
  await uploadKyc(ctx, opsToken, d.id, {
    type: 'VOTER_ID',
    number: `ABC${String(1000000 + n++).slice(-7)}`,
    usedForAddress: 'true',
  }).expect(201);
  await uploadKyc(ctx, opsToken, d.id, {
    type: 'PAN',
    number: `ABCDE${String(1000 + (n++ % 9000)).padStart(4, '0')}F`,
  }).expect(201);
  const profile = (await uploadKyc(ctx, opsToken, d.id, { type: 'DRIVER_PHOTO' }).expect(201))
    .body as { documents: { id: string }[] };
  let last: { readiness: { ready: boolean } } | null = null;
  for (const doc of profile.documents) {
    last = (
      await ctx.http.post(`/v1/kyc-documents/${doc.id}/verify`).set(bearer(opsToken)).expect(200)
    ).body;
  }
  if (!last?.readiness.ready) throw new Error('fixture driver is not ready');
  return d;
}

/** A ready driver with head office's final approval on the given plan (founder, 1 Nov 2026). */
export async function approvedDriver(
  ctx: TestContext,
  opsToken: string,
  planId: string,
  overrides: Record<string, unknown> = {},
) {
  const d = await readyDriver(ctx, opsToken, { ...overrides, planId });
  await ctx.http.post(`/v1/drivers/${d.id}/approve`).set(bearer(opsToken)).send({}).expect(200);
  return d;
}

/** The next 17th at least 7 days away (a valid first due date for drafts). */
export function nextSeventeenth() {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  const day = Number(today.slice(8, 10));
  const [y, m] = today.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1 + (day <= 10 ? 0 : 1), 17)).toISOString().slice(0, 10);
}

/** A published plan with one price row: by default ₹20,000 + 18 × ₹3,000 = ₹74,000. */
export async function publishedPlan(
  ctx: TestContext,
  pmToken: string,
  batteryTypeId: string,
  opts: { down?: number; monthly?: number; term?: number } = {},
) {
  const plan = await makePlan(ctx, pmToken);
  const versionId = plan.versions[0]!.id;
  await ctx.http
    .patch(`/v1/plan-versions/${versionId}`)
    .set(bearer(pmToken))
    .send({
      termMonths: opts.term ?? 18,
      prices: [
        {
          batteryTypeId,
          downPayment: r(opts.down ?? 20000),
          instalment: r(opts.monthly ?? 3000),
        },
      ],
    })
    .expect(200);
  await ctx.http
    .post(`/v1/plan-versions/${versionId}/publish`)
    .set(bearer(pmToken))
    .send({})
    .expect(200);
  return { plan, versionId };
}

export async function makeBattery(
  ctx: TestContext,
  token: string,
  batteryTypeId: string,
  opts: { gps?: boolean } = {},
) {
  n += 1;
  const res = await ctx.http
    .post('/v1/batteries')
    .set(bearer(token))
    .send({
      serial: `NEO-T-${n}`,
      gpsDeviceId: opts.gps === false ? null : String(356000000000000 + n),
      batteryTypeId,
      purchaseDate: '2026-10-01',
      location: 'Head office store',
    })
    .expect(201);
  return res.body as { id: string; serial: string };
}

/**
 * An installed, active agreement: ₹20,000 down payment (paid in cash by
 * finance) + 18 × ₹3,000 on the 17th, first due on the next 17th at least a
 * week away.
 */
export async function activeAgreement(
  ctx: TestContext,
  t: { ops: string; finance: string; pm: string },
  opts: {
    typeId?: string;
    versionId?: string;
    /** Who records the installation and installs (default: ops, a new technician). */
    installAs?: { token: string; staffId: string };
  } = {},
) {
  const typeId = opts.typeId ?? (await makeBatteryType(ctx, t.pm, { purchase: 50000 })).id;
  const versionId = opts.versionId ?? (await publishedPlan(ctx, t.pm, typeId)).versionId;
  const { planId } = await ctx.prisma.planVersion.findUniqueOrThrow({ where: { id: versionId } });
  const driver = await approvedDriver(ctx, t.ops, planId);
  const firstDueDate = nextSeventeenth();
  // Head office assigns a battery; the agreement is prepared with it (founder, 1 Nov 2026).
  const battery = await makeBattery(ctx, t.ops, typeId);
  const draft = await ctx.http
    .post('/v1/agreements')
    .set(bearer(t.ops))
    .send({ driverId: driver.id, batteryId: battery.id, dueDay: 17, firstDueDate })
    .expect(201);
  const id = draft.body.id as string;
  await ctx.http
    .post(`/v1/agreements/${id}/sign`)
    .set(bearer(t.ops))
    .field('signedAt', new Date().toISOString())
    .field('explainedInLanguage', 'BN')
    .field('stampPaperNumber', 'WB-NJ-123456')
    .field('stampValueRupees', '100')
    .field('stampPurchasedOn', '2026-10-01')
    .attach('files', PDF, 'signed.pdf')
    .expect(200);
  await ctx.http
    .post('/v1/payments')
    .set(bearer(t.finance))
    .send({ agreementId: id, amountPaise: r(20000), method: 'CASH' })
    .expect(201);
  const techId =
    opts.installAs?.staffId ??
    (
      await ctx.prisma.staffUser.create({
        data: { name: `Tech ${n++}`, email: `tech.${n}@voltneo.test`, role: 'TECHNICIAN' },
      })
    ).id;
  const res = await ctx.http
    .post(`/v1/agreements/${id}/installation`)
    .set(bearer(opts.installAs?.token ?? t.ops))
    .field('technicianId', techId)
    .field('installedAt', new Date().toISOString())
    .field('location', 'Baruipur')
    .field('geoLat', '22.3591')
    .field('geoLng', '88.4318')
    .field('geoAccuracyM', '15')
    .field('voltageReading', '52.4')
    .field('conditionNote', 'Good')
    .field('driverConfirmed', 'true')
    .attach('photos', PNG, 'p.png')
    .expect(200);
  return {
    id,
    number: res.body.number as string,
    firstDueDate,
    battery,
    driverPhone: driver.phone,
    typeId,
    versionId,
  };
}

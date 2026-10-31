import zlib from 'node:zlib';
import { rupeesToPaise as r } from '@voltneo/shared';
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

export async function makeDriver(
  ctx: TestContext,
  token: string,
  overrides: Record<string, unknown> = {},
) {
  n += 1;
  const res = await ctx.http
    .post('/v1/drivers')
    .set(bearer(token))
    .send({
      name: `Driver ${n}`,
      phone: `98${String(30000000 + n).padStart(8, '0')}`,
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

/** A driver whose readiness checklist is complete (identity, address, photo verified). */
export async function readyDriver(
  ctx: TestContext,
  opsToken: string,
  overrides: Record<string, unknown> = {},
) {
  const d = await makeDriver(ctx, opsToken, overrides);
  await uploadKyc(ctx, opsToken, d.id, {
    type: 'VOTER_ID',
    number: `ABC${String(1000000 + n++).slice(-7)}`,
    usedForAddress: 'true',
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
      gpsDeviceId: opts.gps === false ? null : `GPS-T-${n}`,
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
  opts: { typeId?: string; versionId?: string } = {},
) {
  const typeId = opts.typeId ?? (await makeBatteryType(ctx, t.pm, { purchase: 50000 })).id;
  const versionId = opts.versionId ?? (await publishedPlan(ctx, t.pm, typeId)).versionId;
  const driver = await readyDriver(ctx, t.ops);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  const day = Number(today.slice(8, 10));
  const [y, m] = today.split('-').map(Number) as [number, number];
  // The next 17th at least 7 days away.
  const next = new Date(Date.UTC(y, m - 1 + (day <= 10 ? 0 : 1), 17));
  const firstDueDate = next.toISOString().slice(0, 10);
  const draft = await ctx.http
    .post('/v1/agreements')
    .set(bearer(t.ops))
    .send({
      driverId: driver.id,
      planVersionId: versionId,
      batteryTypeId: typeId,
      dueDay: 17,
      firstDueDate,
    })
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
  const battery = await makeBattery(ctx, t.ops, typeId);
  const tech = await ctx.prisma.staffUser.create({
    data: { name: `Tech ${n++}`, email: `tech.${n}@voltneo.test`, role: 'TECHNICIAN' },
  });
  const res = await ctx.http
    .post(`/v1/agreements/${id}/installation`)
    .set(bearer(t.ops))
    .field('batteryId', battery.id)
    .field('technicianId', tech.id)
    .field('installedAt', new Date().toISOString())
    .field('location', 'Baruipur')
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

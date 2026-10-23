import { rupeesToPaise as r } from '@voltneo/shared';
import { bearer, type TestContext } from './helpers';

export const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('test image body'),
]);
export const PDF = Buffer.from('%PDF-1.4\n% test consent form\n');
export const NOT_A_DOC = Buffer.from('MZ this is not an image');

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

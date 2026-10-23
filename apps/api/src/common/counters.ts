import type { Tx } from './util';

/**
 * Next value of a gap-free number series. The counter row stays locked until
 * the transaction ends, and a rolled-back transaction gives its number back,
 * so receipts and agreement numbers never skip.
 */
export async function nextCounter(tx: Tx, name: string): Promise<number> {
  const rows = await tx.$queryRaw<{ value: number }[]>`
    INSERT INTO "counters" ("name", "value") VALUES (${name}, 1)
    ON CONFLICT ("name") DO UPDATE SET "value" = "counters"."value" + 1
    RETURNING "value"`;
  return rows[0]!.value;
}

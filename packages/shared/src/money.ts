/**
 * Money is stored and calculated in paise as whole numbers, never as decimals
 * (Platform MVP Spec V1, section 5).
 */

export type Paise = number;

export function assertPaise(value: number): asserts value is Paise {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`Money must be a whole number of paise, got ${value}`);
  }
}

export function rupeesToPaise(rupees: number): Paise {
  const paise = Math.round(rupees * 100);
  assertPaise(paise);
  return paise;
}

/** Formats paise as Indian rupees, e.g. 7400000 -> "₹74,000". */
export function formatRupees(paise: Paise, opts: { showPaise?: boolean } = {}): string {
  assertPaise(paise);
  const showPaise = opts.showPaise ?? paise % 100 !== 0;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: showPaise ? 2 : 0,
    maximumFractionDigits: showPaise ? 2 : 0,
  }).format(paise / 100);
}

export function sumPaise(values: readonly Paise[]): Paise {
  let total = 0;
  for (const v of values) {
    assertPaise(v);
    total += v;
  }
  assertPaise(total);
  return total;
}

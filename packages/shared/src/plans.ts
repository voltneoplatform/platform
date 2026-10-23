/**
 * Neo Own plans: total payable, the cost floor and plan-name rules
 * (Platform MVP Spec V1, rules 1-2 and module 4; Foundation V2.1 section 5).
 */
import { assertPaise, type Paise } from './money';

/**
 * Non-payment terms in force today (D33, D38). They are copied onto every plan
 * version when it is created, so a driver keeps the terms they signed even if
 * the policy changes later. M3 reads them from the version.
 *
 * CONFIRMED 23 Oct 2026 (D38 changed, was 60 days): the late fee is ₹100 a day
 * however many instalments are overdue (no stacking), for at most 30 days in
 * each late spell. A late spell starts when a due date passes unpaid and ends
 * when nothing is overdue (every instalment that has fallen due and every late
 * fee paid); the next missed due date starts a new spell.
 */
export const NON_PAYMENT_POLICY = {
  graceDays: 5,
  lateFeePerDayPaise: 10_000,
  lateFeeCapDays: 30,
} as const;

export const MAX_TERM_MONTHS = 120;

/** Down payment plus every instalment (Foundation section 5). */
export function totalPayable(downPayment: Paise, instalment: Paise, termMonths: number): Paise {
  assertPaise(downPayment);
  assertPaise(instalment);
  if (!Number.isInteger(termMonths) || termMonths < 1) {
    throw new RangeError('Term must be a whole number of months, at least 1');
  }
  const total = downPayment + instalment * termMonths;
  assertPaise(total);
  return total;
}

/**
 * What a battery type must recover over a plan, entered by head office.
 * PROPOSED until the unit economics model exists: the floor is the purchase
 * cost plus per-battery allowances for each cost the Foundation lists
 * (section 6, pricing logic). An allowance left at zero adds nothing, so the
 * floor is never below the purchase cost.
 */
export interface CostBasis {
  purchaseCost: Paise;
  gpsCost: Paise;
  serviceCost: Paise;
  financingCost: Paise;
  collectionCost: Paise;
  expectedLossCost: Paise;
}

export const COST_BASIS_LABELS: Record<keyof CostBasis, string> = {
  purchaseCost: 'Purchase cost',
  gpsCost: 'GPS module, SIM and platform',
  serviceCost: 'Installation, repair and replacement',
  financingCost: 'Cost of capital',
  collectionCost: 'Collection and cash handling',
  expectedLossCost: 'Expected losses (defaults, theft)',
};

export function costFloor(basis: CostBasis): Paise {
  let total = 0;
  for (const key of Object.keys(COST_BASIS_LABELS) as (keyof CostBasis)[]) {
    const v = basis[key];
    assertPaise(v);
    if (v < 0) throw new RangeError(`${COST_BASIS_LABELS[key]} cannot be negative`);
    total += v;
  }
  assertPaise(total);
  return total;
}

export interface PriceCheck {
  batteryTypeId: string;
  totalPayable: Paise;
  costFloor: Paise;
  /** Total payable minus cost floor; negative means below the floor. */
  margin: Paise;
  passes: boolean;
}

export function checkPrice(input: {
  batteryTypeId: string;
  downPayment: Paise;
  instalment: Paise;
  termMonths: number;
  basis: CostBasis;
}): PriceCheck {
  const total = totalPayable(input.downPayment, input.instalment, input.termMonths);
  const floor = costFloor(input.basis);
  return {
    batteryTypeId: input.batteryTypeId,
    totalPayable: total,
    costFloor: floor,
    margin: total - floor,
    passes: total >= floor,
  };
}

// ---------------------------------------------------------------------------
// Plan names (Foundation section 5, naming rules 2 and 4; D27)
// ---------------------------------------------------------------------------

export const PLAN_LANGUAGES = ['bn', 'hi', 'en'] as const;
export type PlanLanguage = (typeof PLAN_LANGUAGES)[number];

export const PLAN_LANGUAGE_LABELS: Record<PlanLanguage, string> = {
  bn: 'Bengali',
  hi: 'Hindi',
  en: 'English',
};

export type PlanNames = Record<PlanLanguage, string>;

/** PROPOSED: short enough to fit on one line of a phone screen. */
export const PLAN_NAME_MAX_LENGTH = 32;

/**
 * Words that make unsupported claims (Foundation section 12, claims to avoid).
 * PROPOSED list. The Bengali and Hindi entries need review by a native speaker.
 */
export const BLOCKED_PLAN_WORDS: readonly string[] = [
  'cheapest',
  'cheap',
  'best',
  'guarantee',
  'guaranteed',
  'free',
  'zero',
  'lowest',
  'no.1',
  'number 1',
  '100%',
  'সবচেয়ে সস্তা',
  'সেরা',
  'গ্যারান্টি',
  'ফ্রি',
  'বিনামূল্যে',
  'सबसे सस्ता',
  'सबसे अच्छा',
  'गारंटी',
  'फ्री',
  'मुफ्त',
];

/** Trims and collapses inner spaces. Names are compared case-insensitively. */
export function normalisePlanName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

export function planNameKey(raw: string): string {
  return normalisePlanName(raw).toLocaleLowerCase('en-IN');
}

/** Returns a list of problems; empty means the names are acceptable. */
export function planNameProblems(names: Partial<PlanNames>): string[] {
  const problems: string[] = [];
  for (const lang of PLAN_LANGUAGES) {
    const label = PLAN_LANGUAGE_LABELS[lang];
    const name = normalisePlanName(names[lang] ?? '');
    if (!name) {
      problems.push(`${label} name is required`);
      continue;
    }
    if ([...name].length > PLAN_NAME_MAX_LENGTH) {
      problems.push(`${label} name must be ${PLAN_NAME_MAX_LENGTH} characters or fewer`);
    }
    const lower = name.toLocaleLowerCase('en-IN');
    const blocked = BLOCKED_PLAN_WORDS.find((w) => {
      if (/^[a-z0-9 .%]+$/.test(w)) {
        // Whole words only, so "freedom" is not caught by "free".
        const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`).test(lower);
      }
      return lower.includes(w);
    });
    if (blocked) problems.push(`${label} name makes an unsupported claim ("${blocked}")`);
  }
  return problems;
}

/** Internal plan codes never change: NO-P01, NO-P02 ... */
export function planCode(sequence: number): string {
  return `NO-P${String(sequence).padStart(2, '0')}`;
}

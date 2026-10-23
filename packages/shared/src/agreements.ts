/**
 * Neo Own agreements and instalment schedules (Platform MVP Spec V1, modules 6-7;
 * Agreement Structure Draft V1, Part B and Schedule 1).
 *
 * Dates are calendar dates in India (YYYY-MM-DD strings).
 */

import type { Paise } from './money';

/** One due date each month: the 2nd or the 17th (D35, D37, clause B4). */
export const DUE_DAYS = [2, 17] as const;
export type DueDay = (typeof DUE_DAYS)[number];

export function isDueDay(n: unknown): n is DueDay {
  return n === 2 || n === 17;
}

/**
 * ASSUMED: the first due date is at least 7 days after the agreement is
 * prepared, and the battery is installed at least 7 days before it, so a driver
 * never owes an instalment within a week of getting the battery.
 */
export const MIN_DAYS_TO_FIRST_DUE = 7;
/** CONFIRMED (D39): the battery is collected 30 days after it is disabled. */
export const RECOVERY_AFTER_DAYS = 30;
/** CONFIRMED (D48): a technician responds to a reported fault within 48 hours. */
export const SERVICE_RESPONSE_HOURS = 48;

/** ASSUMED: the first due date is set no more than 75 days ahead. */
export const MAX_DAYS_TO_FIRST_DUE = 75;

export const AGREEMENT_STATES = [
  'DRAFT',
  'AWAITING_DOWN_PAYMENT',
  'AWAITING_INSTALLATION',
  'ACTIVE',
  'IN_GRACE',
  'IMMOBILISED',
  'RECOVERED',
  'CLOSED',
  'PAID_OFF',
  'EARLY_EXIT',
  'TRANSFERRED',
  'CANCELLED',
] as const;
export type AgreementState = (typeof AGREEMENT_STATES)[number];

export const AGREEMENT_STATE_LABELS: Record<AgreementState, string> = {
  DRAFT: 'Draft',
  AWAITING_DOWN_PAYMENT: 'Signed, awaiting down payment',
  AWAITING_INSTALLATION: 'Awaiting installation',
  ACTIVE: 'Active',
  IN_GRACE: 'Overdue',
  IMMOBILISED: 'Battery disabled',
  RECOVERED: 'Battery recovered',
  CLOSED: 'Closed',
  PAID_OFF: 'Paid off',
  EARLY_EXIT: 'Paid off early',
  TRANSFERRED: 'Ownership transferred',
  CANCELLED: 'Cancelled',
};

/**
 * Allowed state changes (spec module 6). CANCELLED is PROPOSED: a draft, or a
 * signed agreement before any money is received, can be cancelled. Paying in
 * full from grace or disabled goes straight to paid off.
 */
export const AGREEMENT_TRANSITIONS: Record<AgreementState, readonly AgreementState[]> = {
  DRAFT: ['AWAITING_DOWN_PAYMENT', 'AWAITING_INSTALLATION', 'CANCELLED'],
  AWAITING_DOWN_PAYMENT: ['AWAITING_INSTALLATION', 'CANCELLED'],
  AWAITING_INSTALLATION: ['ACTIVE'],
  ACTIVE: ['IN_GRACE', 'PAID_OFF', 'EARLY_EXIT'],
  IN_GRACE: ['ACTIVE', 'IMMOBILISED', 'PAID_OFF', 'EARLY_EXIT'],
  IMMOBILISED: ['ACTIVE', 'IN_GRACE', 'RECOVERED', 'PAID_OFF', 'EARLY_EXIT'],
  RECOVERED: ['CLOSED'],
  PAID_OFF: ['TRANSFERRED'],
  EARLY_EXIT: ['TRANSFERRED'],
  CLOSED: [],
  TRANSFERRED: [],
  CANCELLED: [],
};

export function canTransition(from: AgreementState, to: AgreementState): boolean {
  return AGREEMENT_TRANSITIONS[from].includes(to);
}

/** States in which the agreement still ties up the driver, vehicle or battery. */
export const OPEN_AGREEMENT_STATES: readonly AgreementState[] = AGREEMENT_STATES.filter(
  (s) => !['CLOSED', 'TRANSFERRED', 'CANCELLED'].includes(s),
);

/** States in which money can be received. */
export const PAYABLE_STATES: readonly AgreementState[] = [
  'AWAITING_DOWN_PAYMENT',
  'ACTIVE',
  'IN_GRACE',
  'IMMOBILISED',
];

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

function parts(date: string): [number, number, number] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new RangeError(`Not a date: ${date}`);
  return date.split('-').map(Number) as [number, number, number];
}

function fmt(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Adds whole months; only used with the 2nd or 17th, which every month has. */
export function addMonths(date: string, months: number): string {
  const [y, m, d] = parts(date);
  const index = y * 12 + (m - 1) + months;
  return fmt(Math.floor(index / 12), (index % 12) + 1, d);
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = parts(date);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return fmt(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

export function daysBetween(from: string, to: string): number {
  const [y1, m1, d1] = parts(from);
  const [y2, m2, d2] = parts(to);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}

/** The earliest date on the given due day that respects the minimum lead time. */
export function suggestFirstDueDate(dueDay: DueDay, today: string): string {
  const earliest = addDays(today, MIN_DAYS_TO_FIRST_DUE);
  const [y, m, d] = parts(earliest);
  const sameMonth = fmt(y, m, dueDay);
  return d <= dueDay ? sameMonth : addMonths(sameMonth, 1);
}

/** Returns an error message, or null if the first due date is acceptable. */
export function firstDueDateProblem(
  firstDueDate: string,
  dueDay: DueDay,
  today: string,
): string | null {
  const [, , d] = parts(firstDueDate);
  if (d !== dueDay) return `The first due date must fall on the ${ordinal(dueDay)}`;
  const lead = daysBetween(today, firstDueDate);
  if (lead < MIN_DAYS_TO_FIRST_DUE) {
    return `The first due date must be at least ${MIN_DAYS_TO_FIRST_DUE} days from today`;
  }
  if (lead > MAX_DAYS_TO_FIRST_DUE) {
    return `The first due date must be within ${MAX_DAYS_TO_FIRST_DUE} days from today`;
  }
  return null;
}

/** Returns an error message, or null if installation on this date is allowed. */
export function installationDateProblem(installedOn: string, firstDueDate: string): string | null {
  if (daysBetween(installedOn, firstDueDate) < MIN_DAYS_TO_FIRST_DUE) {
    return `Installation must be at least ${MIN_DAYS_TO_FIRST_DUE} days before the first due date (${firstDueDate}). Ask head office to move the first due date.`;
  }
  return null;
}

export function ordinal(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

// ---------------------------------------------------------------------------
// Schedule
// ---------------------------------------------------------------------------

export interface ScheduleInput {
  downPayment: Paise;
  instalment: Paise;
  termMonths: number;
  firstDueDate: string;
}

export interface ScheduleLine {
  /** 0 is the down payment; 1..N are the monthly instalments. */
  sequence: number;
  /** Null for the down payment: it is paid before installation, not on a date. */
  dueDate: string | null;
  amount: Paise;
}

export interface Schedule {
  lines: ScheduleLine[];
  totalPayable: Paise;
  firstDueDate: string;
  lastDueDate: string;
}

/** The down payment followed by one instalment a month from the first due date. */
export function buildSchedule(input: ScheduleInput): Schedule {
  const { downPayment, instalment, termMonths, firstDueDate } = input;
  if (!Number.isInteger(termMonths) || termMonths < 1) {
    throw new RangeError('The number of instalments must be a whole number of at least 1');
  }
  const [, , d] = parts(firstDueDate);
  if (!isDueDay(d)) throw new RangeError('The first due date must be on the 2nd or the 17th');
  const lines: ScheduleLine[] = [{ sequence: 0, dueDate: null, amount: downPayment }];
  for (let i = 1; i <= termMonths; i++) {
    lines.push({ sequence: i, dueDate: addMonths(firstDueDate, i - 1), amount: instalment });
  }
  return {
    lines,
    totalPayable: downPayment + instalment * termMonths,
    firstDueDate,
    lastDueDate: addMonths(firstDueDate, termMonths - 1),
  };
}

/**
 * PROPOSED: finishing while two or more instalments were not yet due counts as
 * an early exit (clause E7); otherwise the agreement is simply paid off. Both
 * lead to ownership transfer.
 */
export function completionState(
  completedOn: string,
  dueDates: readonly string[],
): 'PAID_OFF' | 'EARLY_EXIT' {
  const sorted = [...dueDates].sort();
  const penultimate = sorted[sorted.length - 2];
  return penultimate && completedOn < penultimate ? 'EARLY_EXIT' : 'PAID_OFF';
}

/** Fixed internal agreement number, e.g. NOA-000123. */
export function agreementNumber(seq: number): string {
  return `NOA-${String(seq).padStart(6, '0')}`;
}

/**
 * Version of the agreement wording printed on every document. Still a draft:
 * the lawyer has not reviewed it (Agreement Structure Draft V1, section 1).
 */
export const AGREEMENT_DOCUMENT_VERSION = 'NO-AGR-DRAFT-1';
export const AGREEMENT_DOCUMENT_IS_DRAFT = true;

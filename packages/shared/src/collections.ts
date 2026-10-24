/**
 * Collections: reminders, grace, final notice, late fee, immobilisation,
 * restore and recovery (Platform MVP Spec V1, rules 7-12 and module 9;
 * Foundation D33, D38, D39, D41, D45).
 *
 * Day counting: the due date is day 0. Days 1-5 are grace, the final notice
 * goes on day 5, and from day 6 the battery may be disabled and the late fee
 * runs. Dates are calendar dates in India (YYYY-MM-DD).
 */

import { addDays, daysBetween } from './agreements';

/** CONFIRMED (D41): reminders 5, 3 and 1 day before the due date, and on it. */
export const REMINDER_OFFSETS = [5, 3, 1, 0] as const;
export type ReminderOffset = (typeof REMINDER_OFFSETS)[number];

/** Which reminder (days before the due date) is due today, if any. */
export function reminderOffset(dueDate: string, today: string): ReminderOffset | null {
  const before = daysBetween(today, dueDate);
  return (REMINDER_OFFSETS as readonly number[]).includes(before)
    ? (before as ReminderOffset)
    : null;
}

export interface LatePolicy {
  graceDays: number;
  lateFeePerDayPaise: number;
  lateFeeCapDays: number;
}

/**
 * Day of the late spell: 0 on the missed due date that opened it, 1 the next
 * day, and so on. A spell ends only when nothing is overdue (D38).
 */
export function spellDay(spellStartedOn: string, today: string): number {
  return daysBetween(spellStartedOn, today);
}

/** First day the battery may be disabled and the late fee runs (day 6). */
export function firstLateFeeDay(spellStartedOn: string, policy: LatePolicy): string {
  return addDays(spellStartedOn, policy.graceDays + 1);
}

/**
 * CONFIRMED (D38, 23 Oct 2026): ₹100 a day per agreement however many
 * instalments are overdue, from day 6, for at most 30 days per late spell.
 */
export function lateFeeApplies(input: {
  spellStartedOn: string;
  today: string;
  feeDaysAlreadyCharged: number;
  instalmentOverdue: boolean;
  policy: LatePolicy;
}): boolean {
  const { spellStartedOn, today, feeDaysAlreadyCharged, instalmentOverdue, policy } = input;
  if (!instalmentOverdue || policy.lateFeePerDayPaise <= 0) return false;
  if (spellDay(spellStartedOn, today) < policy.graceDays + 1) return false;
  return feeDaysAlreadyCharged < policy.lateFeeCapDays;
}

/** The final notice goes on the last grace day (day 5), or late if a run was missed. */
export function finalNoticeDue(spellStartedOn: string, today: string, policy: LatePolicy): boolean {
  return spellDay(spellStartedOn, today) >= policy.graceDays;
}

/** Immobilisation can be requested from the final-notice day and approved from day 6. */
export function immobilisationRequestAllowed(
  spellStartedOn: string,
  today: string,
  policy: LatePolicy,
): boolean {
  return spellDay(spellStartedOn, today) >= policy.graceDays;
}

export function immobilisationApprovalAllowed(
  spellStartedOn: string,
  today: string,
  policy: LatePolicy,
): boolean {
  return spellDay(spellStartedOn, today) >= policy.graceDays + 1;
}

/** CONFIRMED (D39): recovery is due 30 days after the battery was disabled. */
export function recoveryDueOn(immobilisedOn: string, afterDays: number): string {
  return addDays(immobilisedOn, afterDays);
}

export const COLLECTION_STAGES = [
  'GRACE',
  'FINAL_NOTICE',
  'DUE_FOR_IMMOBILISATION',
  'IMMOBILISATION_REQUESTED',
  'AWAITING_DISABLE',
  'IMMOBILISED',
  'RESTORE_DUE',
  'DUE_FOR_RECOVERY',
  'RECOVERY_REQUESTED',
  'AWAITING_COLLECTION',
] as const;
export type CollectionStage = (typeof COLLECTION_STAGES)[number];

export const COLLECTION_STAGE_LABELS: Record<CollectionStage, string> = {
  GRACE: 'In grace',
  FINAL_NOTICE: 'Final notice sent',
  DUE_FOR_IMMOBILISATION: 'Due for immobilisation',
  IMMOBILISATION_REQUESTED: 'Immobilisation awaiting approval',
  AWAITING_DISABLE: 'Approved: disable in GPS portal',
  IMMOBILISED: 'Battery disabled',
  RESTORE_DUE: 'Paid: switch battery back on',
  DUE_FOR_RECOVERY: 'Due for recovery',
  RECOVERY_REQUESTED: 'Recovery awaiting approval',
  AWAITING_COLLECTION: 'Approved: collect battery',
};

/** Where an agreement sits in the collections queue today. */
export function collectionStage(input: {
  today: string;
  policy: LatePolicy;
  recoveryAfterDays: number;
  spellStartedOn: string | null;
  immobilisedOn: string | null;
  restoreDue: boolean;
  immobilisationRequest: 'PENDING' | 'APPROVED' | null;
  recoveryRequest: 'PENDING' | 'APPROVED' | null;
}): CollectionStage | null {
  const i = input;
  if (i.restoreDue) return 'RESTORE_DUE';
  if (i.immobilisedOn) {
    if (i.recoveryRequest === 'APPROVED') return 'AWAITING_COLLECTION';
    if (i.recoveryRequest === 'PENDING') return 'RECOVERY_REQUESTED';
    if (i.today >= recoveryDueOn(i.immobilisedOn, i.recoveryAfterDays)) return 'DUE_FOR_RECOVERY';
    return 'IMMOBILISED';
  }
  if (!i.spellStartedOn) return null;
  if (i.immobilisationRequest === 'APPROVED') return 'AWAITING_DISABLE';
  if (i.immobilisationRequest === 'PENDING') return 'IMMOBILISATION_REQUESTED';
  const day = spellDay(i.spellStartedOn, i.today);
  if (day >= i.policy.graceDays + 1) return 'DUE_FOR_IMMOBILISATION';
  if (day >= i.policy.graceDays) return 'FINAL_NOTICE';
  return 'GRACE';
}

/** Kinds of notice sent to drivers by the collections jobs. */
export const NOTICE_KINDS = [
  'REMINDER_5',
  'REMINDER_3',
  'REMINDER_1',
  'REMINDER_0',
  'FINAL_NOTICE',
  'IMMOBILISED',
  'RESTORED',
] as const;
export type NoticeKind = (typeof NOTICE_KINDS)[number];

export function reminderKind(offset: ReminderOffset): NoticeKind {
  return `REMINDER_${offset}` as NoticeKind;
}

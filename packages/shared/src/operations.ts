/**
 * Operations (Platform MVP Spec V1, milestone M4): service tickets, finishing
 * early and ownership transfer.
 *
 * Dates are calendar dates in India (YYYY-MM-DD strings).
 */

import { SERVICE_RESPONSE_HOURS, completionState, type AgreementState } from './agreements';
import type { Paise } from './money';

// ---------------------------------------------------------------------------
// Service tickets (spec module 10; D42, D47, D48; clause C6)
// ---------------------------------------------------------------------------

export const TICKET_CATEGORIES = [
  'NOT_WORKING',
  'LOW_CAPACITY',
  'CHARGING',
  'PHYSICAL_DAMAGE',
  'GPS_MODULE',
  'OTHER',
] as const;
export type TicketCategory = (typeof TICKET_CATEGORIES)[number];

export const TICKET_CATEGORY_LABELS: Record<TicketCategory, string> = {
  NOT_WORKING: 'Battery not working',
  LOW_CAPACITY: 'Runs out too soon (low capacity)',
  CHARGING: 'Charging problem',
  PHYSICAL_DAMAGE: 'Physical damage',
  GPS_MODULE: 'GPS module problem',
  OTHER: 'Something else',
};

/** How the driver reported it. The Driver App adds APP in M6. */
export const TICKET_CHANNELS = ['PHONE', 'WHATSAPP', 'FIELD_AGENT', 'WALK_IN', 'APP'] as const;
export type TicketChannel = (typeof TICKET_CHANNELS)[number];

export const TICKET_CHANNEL_LABELS: Record<TicketChannel, string> = {
  PHONE: 'Phone call',
  WHATSAPP: 'WhatsApp',
  FIELD_AGENT: 'Told a field agent',
  WALK_IN: 'Came to the office',
  APP: 'Driver App',
};

export const TICKET_STATUSES = ['OPEN', 'ASSIGNED', 'RESOLVED', 'CANCELLED'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  OPEN: 'Waiting for a technician',
  ASSIGNED: 'Technician assigned',
  RESOLVED: 'Resolved',
  CANCELLED: 'Cancelled',
};

/**
 * What the technician found. NOT_COVERED: the fault came from misuse, an
 * accident or someone else's work (clause C7); any charge is decided separately
 * after an inspection report (PROPOSED; amount REQUIRES VALIDATION, L5).
 */
export const TICKET_OUTCOMES = ['REPAIRED', 'REPLACED', 'NO_FAULT_FOUND', 'NOT_COVERED'] as const;
export type TicketOutcome = (typeof TICKET_OUTCOMES)[number];

export const TICKET_OUTCOME_LABELS: Record<TicketOutcome, string> = {
  REPAIRED: 'Repaired',
  REPLACED: 'Battery replaced',
  NO_FAULT_FOUND: 'No fault found',
  NOT_COVERED: 'Not covered (misuse or damage)',
};

/**
 * Volt Neo services the battery only while it owns it and it is fitted (clause
 * C6; D32): not before installation and not once the agreement is paid off.
 */
export const SERVICEABLE_STATES: readonly AgreementState[] = ['ACTIVE', 'IN_GRACE', 'IMMOBILISED'];

const HOUR = 3_600_000;

/** The response deadline: 48 hours after the fault was reported (D48). */
export function ticketDueBy(reportedAt: Date, hours = SERVICE_RESPONSE_HOURS): Date {
  return new Date(reportedAt.getTime() + hours * HOUR);
}

/** Hours before the deadline when a ticket shows as "due soon" (PROPOSED). */
export const TICKET_DUE_SOON_HOURS = 6;

export const TICKET_TIMINGS = ['ON_TIME', 'DUE_SOON', 'MISSED', 'MET', 'MET_LATE'] as const;
export type TicketTiming = (typeof TICKET_TIMINGS)[number];

export const TICKET_TIMING_LABELS: Record<TicketTiming, string> = {
  ON_TIME: 'Within 48 hours',
  DUE_SOON: 'Deadline soon',
  MISSED: '48 hours missed',
  MET: 'Responded in time',
  MET_LATE: 'Responded late',
};

/**
 * Where a ticket stands against its deadline. A response is the technician's
 * first visit or call recorded on the ticket. A cancelled ticket with no
 * response counts as met: nobody was waiting for a technician.
 */
export function ticketTiming(input: {
  dueBy: Date;
  respondedAt: Date | null;
  cancelled?: boolean;
  now: Date;
}): TicketTiming {
  if (input.respondedAt) {
    return input.respondedAt.getTime() <= input.dueBy.getTime() ? 'MET' : 'MET_LATE';
  }
  if (input.cancelled) return 'MET';
  const left = input.dueBy.getTime() - input.now.getTime();
  if (left < 0) return 'MISSED';
  return left <= TICKET_DUE_SOON_HOURS * HOUR ? 'DUE_SOON' : 'ON_TIME';
}

/** Ticket number, e.g. VNS-000042 (gap-free, PROPOSED). */
export function ticketNumber(seq: number): string {
  return `VNS-${String(seq).padStart(6, '0')}`;
}

// ---------------------------------------------------------------------------
// Finishing early (rule 13; D30, D40, D44; clause E7)
// ---------------------------------------------------------------------------

/** States from which a driver can finish early: the battery is installed. */
export const EARLY_EXIT_STATES: readonly AgreementState[] = ['ACTIVE', 'IN_GRACE', 'IMMOBILISED'];

export interface EarlyExitQuote {
  /** Every unpaid instalment, in full: no reduction for paying early (D40). */
  remainingInstalments: Paise;
  instalmentsLeft: number;
  /** ASSUMED (spec rule 13): late fees already owed are paid too. */
  lateFeesDue: Paise;
  total: Paise;
  /** Instalments whose due date is still ahead. */
  notYetDue: number;
  /** What the agreement becomes once paid (T34). */
  resultingState: 'PAID_OFF' | 'EARLY_EXIT';
}

/**
 * The amount that ends the agreement today. The down payment is never deducted
 * (D44). It is the same figure that payment allocation needs to clear every
 * late fee and instalment, so paying it always completes the agreement.
 */
export function earlyExitQuote(input: {
  today: string;
  instalments: readonly {
    sequence: number;
    dueDate: string | null;
    amount: Paise;
    amountPaid: Paise;
  }[];
  lateFees: readonly { amount: Paise; amountPaid: Paise }[];
}): EarlyExitQuote {
  const unpaid = input.instalments.filter((i) => i.sequence > 0 && i.amountPaid < i.amount);
  const remainingInstalments = unpaid.reduce((s, i) => s + i.amount - i.amountPaid, 0);
  const lateFeesDue = input.lateFees.reduce((s, f) => s + f.amount - f.amountPaid, 0);
  const dueDates = input.instalments.filter((i) => i.dueDate).map((i) => i.dueDate!);
  return {
    remainingInstalments,
    instalmentsLeft: unpaid.length,
    lateFeesDue,
    total: remainingInstalments + lateFeesDue,
    notYetDue: dueDates.filter((d) => d >= input.today).length,
    resultingState: completionState(input.today, dueDates),
  };
}

// ---------------------------------------------------------------------------
// Ownership transfer (rule 14; D32; clause E9; Schedule 8)
// ---------------------------------------------------------------------------

/** States waiting for the certificate and GPS switch-off. */
export const TRANSFER_DUE_STATES: readonly AgreementState[] = ['PAID_OFF', 'EARLY_EXIT'];

/** Certificate number, a gap-free series per financial year, e.g. VNC/2026-27/000001. */
export function certificateNumber(fy: string, seq: number): string {
  return `VNC/${fy}/${String(seq).padStart(6, '0')}`;
}

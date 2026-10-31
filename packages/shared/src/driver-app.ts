/**
 * Driver App (M6): what the driver can pay now. The founder decided (31 Oct
 * 2026) that drivers pay only the amount due, never a part and never ahead:
 * everything overdue with its late fees, or the next instalment once it is
 * close to its Due Date.
 */
import { addDays, daysBetween, PAYABLE_STATES, type AgreementState } from './agreements';

/** The next instalment can be paid from this many days before its Due Date: the first reminder (PROPOSED). */
export const EARLY_PAY_DAYS = 5;

export interface DueLine {
  sequence: number;
  dueDate: string;
  amount: number;
  amountPaid: number;
}

export type DueNow =
  /** The down payment, before installation. */
  | { kind: 'DOWN_PAYMENT'; amount: number }
  /** Instalments past their Due Date, or late fees: everything overdue in one payment. */
  | { kind: 'OVERDUE'; amount: number; instalments: number; lateFees: number; since: string }
  /** The instalment due today. */
  | { kind: 'DUE_TODAY'; amount: number; dueDate: string }
  /** The next instalment, within EARLY_PAY_DAYS of its Due Date. */
  | { kind: 'UPCOMING'; amount: number; dueDate: string }
  /** Nothing to pay yet; the next instalment can be paid from payableFrom. */
  | { kind: 'NOT_YET'; amount: 0; dueDate: string; nextAmount: number; payableFrom: string }
  /** Nothing to pay: fully paid, or the agreement cannot take payments. */
  | { kind: 'NONE'; amount: 0 };

export function dueNow(input: {
  state: AgreementState;
  /** Every schedule line, the down payment as sequence 0. */
  lines: readonly DueLine[];
  /** Late fees charged and not yet paid, in paise. */
  lateFeesDue: number;
  today: string;
}): DueNow {
  const left = (l: DueLine) => Math.max(0, l.amount - l.amountPaid);
  if (input.state === 'AWAITING_DOWN_PAYMENT') {
    const dp = input.lines.find((l) => l.sequence === 0);
    const amount = dp ? left(dp) : 0;
    return amount > 0 ? { kind: 'DOWN_PAYMENT', amount } : { kind: 'NONE', amount: 0 };
  }
  if (!(PAYABLE_STATES as readonly string[]).includes(input.state))
    return { kind: 'NONE', amount: 0 };

  const open = input.lines
    .filter((l) => l.sequence > 0 && left(l) > 0)
    .sort((a, b) => a.sequence - b.sequence);
  const due = open.filter((l) => l.dueDate <= input.today);
  const late = due.filter((l) => l.dueDate < input.today);
  if (late.length || input.lateFeesDue > 0) {
    const amount = due.reduce((s, l) => s + left(l), 0) + input.lateFeesDue;
    return {
      kind: 'OVERDUE',
      amount,
      instalments: due.length,
      lateFees: input.lateFeesDue,
      since: (late[0] ?? due[0])?.dueDate ?? input.today,
    };
  }
  if (due.length) {
    return { kind: 'DUE_TODAY', amount: left(due[0]!), dueDate: due[0]!.dueDate };
  }
  const next = open[0];
  if (!next) return { kind: 'NONE', amount: 0 };
  if (daysBetween(input.today, next.dueDate) <= EARLY_PAY_DAYS) {
    return { kind: 'UPCOMING', amount: left(next), dueDate: next.dueDate };
  }
  return {
    kind: 'NOT_YET',
    amount: 0,
    dueDate: next.dueDate,
    nextAmount: left(next),
    payableFrom: addDays(next.dueDate, -EARLY_PAY_DAYS),
  };
}

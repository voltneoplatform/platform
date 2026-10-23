/**
 * Payments, allocation, receipts and the ledger (Platform MVP Spec V1, module 8;
 * Agreement Structure Draft V1, clauses B5, B6 and B10).
 *
 * The ledger here records money movements only. How down payments, instalments
 * and late fees are recognised as revenue, and GST on each, depend on legal
 * item L1 and CA item L3: REQUIRES VALIDATION by a chartered accountant.
 */

import type { Paise } from './money';

export const PAYMENT_METHODS = ['UPI', 'CARD', 'CASH'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  UPI: 'UPI',
  CARD: 'Card',
  CASH: 'Cash',
};

/** Manual: entered by staff. Gateway: arrived through a payment provider webhook. */
export const PAYMENT_SOURCES = ['MANUAL', 'GATEWAY'] as const;
export type PaymentSource = (typeof PAYMENT_SOURCES)[number];

export type DueKind = 'LATE_FEE' | 'DOWN_PAYMENT' | 'INSTALMENT';

export interface DueItem {
  kind: DueKind;
  id: string;
  outstanding: Paise;
  /** Late fees: accrual date. Down payment and instalments: schedule sequence. */
  order: string | number;
}

export interface Allocation {
  kind: DueKind;
  id: string;
  amount: Paise;
}

const KIND_ORDER: Record<DueKind, number> = { LATE_FEE: 0, DOWN_PAYMENT: 1, INSTALMENT: 2 };

/**
 * Clause B10: a payment goes first to late fees (oldest first), then to the
 * oldest unpaid instalment. The down payment counts as the oldest instalment.
 * Part-payments are allowed (B5): an item is met only when fully paid.
 * Whatever is left over is returned as excess.
 */
export function allocatePayment(
  amount: Paise,
  dues: readonly DueItem[],
): { allocations: Allocation[]; excess: Paise } {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new RangeError('A payment must be a positive whole number of paise');
  }
  const ordered = [...dues]
    .filter((d) => d.outstanding > 0)
    .sort((a, b) => {
      if (a.kind !== b.kind) return KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
      if (a.order < b.order) return -1;
      if (a.order > b.order) return 1;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
  let left = amount;
  const allocations: Allocation[] = [];
  for (const d of ordered) {
    if (left === 0) break;
    const take = Math.min(left, d.outstanding);
    allocations.push({ kind: d.kind, id: d.id, amount: take });
    left -= take;
  }
  return { allocations, excess: left };
}

// ---------------------------------------------------------------------------
// Ledger
// ---------------------------------------------------------------------------

export const LEDGER_ACCOUNTS = [
  'GATEWAY_CLEARING',
  'BANK',
  'CASH_WITH_AGENTS',
  'CASH_IN_TRANSIT',
  'DOWN_PAYMENTS_RECEIVED',
  'INSTALMENTS_RECEIVED',
  'LATE_FEES_RECEIVED',
  'DRIVER_CREDIT',
] as const;
export type LedgerAccount = (typeof LEDGER_ACCOUNTS)[number];

export const LEDGER_ACCOUNT_LABELS: Record<LedgerAccount, string> = {
  GATEWAY_CLEARING: 'Payment gateway clearing',
  BANK: 'Bank',
  CASH_WITH_AGENTS: 'Cash held by collecting staff',
  CASH_IN_TRANSIT: 'Cash deposited, awaiting bank check',
  DOWN_PAYMENTS_RECEIVED: 'Down payments received',
  INSTALMENTS_RECEIVED: 'Instalments received',
  LATE_FEES_RECEIVED: 'Late fees received',
  DRIVER_CREDIT: 'Overpayments owed to drivers',
};

/** The account a payment's money lands in. */
export function receivingAccount(method: PaymentMethod, source: PaymentSource): LedgerAccount {
  if (method === 'CASH') return 'CASH_WITH_AGENTS';
  return source === 'GATEWAY' ? 'GATEWAY_CLEARING' : 'BANK';
}

export const ALLOCATION_ACCOUNT: Record<DueKind, LedgerAccount> = {
  LATE_FEE: 'LATE_FEES_RECEIVED',
  DOWN_PAYMENT: 'DOWN_PAYMENTS_RECEIVED',
  INSTALMENT: 'INSTALMENTS_RECEIVED',
};

export interface LedgerLine {
  account: LedgerAccount;
  debit: Paise;
  credit: Paise;
}

/** True when debits equal credits and every line is one-sided and positive. */
export function isBalanced(lines: readonly LedgerLine[]): boolean {
  if (lines.length < 2) return false;
  let net = 0;
  for (const l of lines) {
    const oneSided = (l.debit > 0 && l.credit === 0) || (l.credit > 0 && l.debit === 0);
    if (!oneSided || !Number.isInteger(l.debit) || !Number.isInteger(l.credit)) return false;
    net += l.debit - l.credit;
  }
  return net === 0;
}

/** Journal for a received payment: money in, split by what it paid for. */
export function paymentJournal(input: {
  method: PaymentMethod;
  source: PaymentSource;
  allocations: readonly Allocation[];
  excess: Paise;
}): LedgerLine[] {
  const total = input.allocations.reduce((s, a) => s + a.amount, 0) + input.excess;
  const credits = new Map<LedgerAccount, number>();
  for (const a of input.allocations) {
    const acc = ALLOCATION_ACCOUNT[a.kind];
    credits.set(acc, (credits.get(acc) ?? 0) + a.amount);
  }
  if (input.excess > 0) credits.set('DRIVER_CREDIT', input.excess);
  return [
    { account: receivingAccount(input.method, input.source), debit: total, credit: 0 },
    ...[...credits].map(([account, credit]) => ({ account, debit: 0, credit })),
  ];
}

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

/** Indian financial year label for a date, e.g. 2026-10-23 → "2026-27". */
export function financialYear(date: string): string {
  const [y, m] = date.split('-').map(Number) as [number, number];
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

/**
 * Receipt number: a gap-free series per financial year, e.g. VNR/2026-27/000001.
 * REQUIRES VALIDATION (CA, item L3): GST rules for receipt numbering.
 */
export function receiptNumber(fy: string, seq: number): string {
  return `VNR/${fy}/${String(seq).padStart(6, '0')}`;
}

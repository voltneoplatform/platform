import { describe, expect, it } from 'vitest';
import {
  allocatePayment,
  financialYear,
  isBalanced,
  paymentJournal,
  receiptNumber,
  type DueItem,
} from './payments';
import { rupeesToPaise as r } from './money';

const dues: DueItem[] = [
  { kind: 'INSTALMENT', id: 'i2', outstanding: r(3000), order: 2 },
  { kind: 'INSTALMENT', id: 'i1', outstanding: r(1000), order: 1 },
  { kind: 'LATE_FEE', id: 'f2', outstanding: r(100), order: '2026-12-24' },
  { kind: 'LATE_FEE', id: 'f1', outstanding: r(100), order: '2026-12-23' },
  { kind: 'DOWN_PAYMENT', id: 'dp', outstanding: 0, order: 0 },
];

describe('allocation (clause B10: late fees first, then the oldest instalment)', () => {
  it('pays late fees oldest first, then instalments in order', () => {
    expect(allocatePayment(r(1500), dues)).toEqual({
      allocations: [
        { kind: 'LATE_FEE', id: 'f1', amount: r(100) },
        { kind: 'LATE_FEE', id: 'f2', amount: r(100) },
        { kind: 'INSTALMENT', id: 'i1', amount: r(1000) },
        { kind: 'INSTALMENT', id: 'i2', amount: r(300) },
      ],
      excess: 0,
    });
  });

  it('accepts part-payments (clause B5)', () => {
    expect(allocatePayment(r(50), dues).allocations).toEqual([
      { kind: 'LATE_FEE', id: 'f1', amount: r(50) },
    ]);
  });

  it('puts the down payment before any instalment', () => {
    const d: DueItem[] = [
      { kind: 'INSTALMENT', id: 'i1', outstanding: r(3000), order: 1 },
      { kind: 'DOWN_PAYMENT', id: 'dp', outstanding: r(20000), order: 0 },
    ];
    expect(allocatePayment(r(20000), d).allocations).toEqual([
      { kind: 'DOWN_PAYMENT', id: 'dp', amount: r(20000) },
    ]);
  });

  it('returns what is left over as excess', () => {
    expect(allocatePayment(r(5000), dues).excess).toBe(r(800));
  });

  it('refuses zero, negative or fractional amounts', () => {
    expect(() => allocatePayment(0, dues)).toThrow(RangeError);
    expect(() => allocatePayment(-1, dues)).toThrow(RangeError);
    expect(() => allocatePayment(1.5, dues)).toThrow(RangeError);
  });
});

describe('ledger journals', () => {
  it('books cash to the agent and splits the credit by what was paid', () => {
    const lines = paymentJournal({
      method: 'CASH',
      source: 'MANUAL',
      allocations: [
        { kind: 'LATE_FEE', id: 'f1', amount: r(100) },
        { kind: 'INSTALMENT', id: 'i1', amount: r(1000) },
        { kind: 'INSTALMENT', id: 'i2', amount: r(400) },
      ],
      excess: 0,
    });
    expect(lines).toEqual([
      { account: 'CASH_WITH_AGENTS', debit: r(1500), credit: 0 },
      { account: 'LATE_FEES_RECEIVED', debit: 0, credit: r(100) },
      { account: 'INSTALMENTS_RECEIVED', debit: 0, credit: r(1400) },
    ]);
    expect(isBalanced(lines)).toBe(true);
  });

  it('books gateway money to clearing and excess to driver credit', () => {
    const lines = paymentJournal({
      method: 'UPI',
      source: 'GATEWAY',
      allocations: [{ kind: 'DOWN_PAYMENT', id: 'dp', amount: r(200) }],
      excess: r(50),
    });
    expect(lines[0]).toEqual({ account: 'GATEWAY_CLEARING', debit: r(250), credit: 0 });
    expect(lines).toContainEqual({ account: 'DRIVER_CREDIT', debit: 0, credit: r(50) });
    expect(isBalanced(lines)).toBe(true);
  });

  it('rejects unbalanced or two-sided lines', () => {
    expect(isBalanced([{ account: 'BANK', debit: 1, credit: 0 }])).toBe(false);
    expect(
      isBalanced([
        { account: 'BANK', debit: 2, credit: 0 },
        { account: 'INSTALMENTS_RECEIVED', debit: 0, credit: 1 },
      ]),
    ).toBe(false);
    expect(
      isBalanced([
        { account: 'BANK', debit: 1, credit: 1 },
        { account: 'INSTALMENTS_RECEIVED', debit: 0, credit: 0 },
      ]),
    ).toBe(false);
  });
});

describe('receipt numbers', () => {
  it('runs per Indian financial year (April to March)', () => {
    expect(financialYear('2026-10-23')).toBe('2026-27');
    expect(financialYear('2027-03-31')).toBe('2026-27');
    expect(financialYear('2027-04-01')).toBe('2027-28');
    expect(financialYear('2099-06-01')).toBe('2099-00');
    expect(receiptNumber('2026-27', 42)).toBe('VNR/2026-27/000042');
  });
});

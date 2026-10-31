import { describe, expect, it } from 'vitest';
import { dueNow, type DueLine } from './driver-app';

const lines: DueLine[] = [
  { sequence: 0, dueDate: '2026-10-01', amount: 2_000_000, amountPaid: 2_000_000 },
  { sequence: 1, dueDate: '2026-11-02', amount: 300_000, amountPaid: 0 },
  { sequence: 2, dueDate: '2026-12-02', amount: 300_000, amountPaid: 0 },
];

describe('what the driver can pay now', () => {
  it('asks for the down payment before installation', () => {
    const r = dueNow({
      state: 'AWAITING_DOWN_PAYMENT',
      lines: [{ ...lines[0]!, amountPaid: 500_000 }, lines[1]!],
      lateFeesDue: 0,
      today: '2026-10-01',
    });
    expect(r).toEqual({ kind: 'DOWN_PAYMENT', amount: 1_500_000 });
  });

  it('offers nothing until 5 days before the Due Date', () => {
    expect(dueNow({ state: 'ACTIVE', lines, lateFeesDue: 0, today: '2026-10-27' })).toEqual({
      kind: 'NOT_YET',
      amount: 0,
      dueDate: '2026-11-02',
      nextAmount: 300_000,
      payableFrom: '2026-10-28',
    });
    expect(dueNow({ state: 'ACTIVE', lines, lateFeesDue: 0, today: '2026-10-28' })).toEqual({
      kind: 'UPCOMING',
      amount: 300_000,
      dueDate: '2026-11-02',
    });
  });

  it('asks for what is left of an instalment due today', () => {
    const part = lines.map((l) => (l.sequence === 1 ? { ...l, amountPaid: 100_000 } : l));
    expect(dueNow({ state: 'ACTIVE', lines: part, lateFeesDue: 0, today: '2026-11-02' })).toEqual({
      kind: 'DUE_TODAY',
      amount: 200_000,
      dueDate: '2026-11-02',
    });
  });

  it('asks for everything overdue with late fees, in one payment', () => {
    expect(
      dueNow({ state: 'IMMOBILISED', lines, lateFeesDue: 50_000, today: '2026-12-02' }),
    ).toEqual({
      kind: 'OVERDUE',
      amount: 650_000,
      instalments: 2,
      lateFees: 50_000,
      since: '2026-11-02',
    });
  });

  it('offers nothing once paid off or in a state that takes no payments', () => {
    const paid = lines.map((l) => ({ ...l, amountPaid: l.amount }));
    expect(dueNow({ state: 'ACTIVE', lines: paid, lateFeesDue: 0, today: '2026-12-02' }).kind).toBe(
      'NONE',
    );
    expect(dueNow({ state: 'RECOVERED', lines, lateFeesDue: 0, today: '2026-12-02' }).kind).toBe(
      'NONE',
    );
  });
});

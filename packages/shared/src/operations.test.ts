import { describe, expect, it } from 'vitest';
import {
  certificateNumber,
  earlyExitQuote,
  ticketDueBy,
  ticketNumber,
  ticketTiming,
} from './operations';
import { hasPermission } from './roles';

const H = 3_600_000;

describe('service ticket deadline (D48)', () => {
  const reported = new Date('2026-11-01T10:00:00+05:30');
  const due = ticketDueBy(reported);

  it('is 48 hours after the report', () => {
    expect(due.toISOString()).toBe(new Date('2026-11-03T10:00:00+05:30').toISOString());
  });

  it('is on time, then due soon in the last 6 hours, then missed', () => {
    const at = (h: number) => new Date(reported.getTime() + h * H);
    expect(ticketTiming({ dueBy: due, respondedAt: null, now: at(1) })).toBe('ON_TIME');
    expect(ticketTiming({ dueBy: due, respondedAt: null, now: at(42) })).toBe('DUE_SOON');
    expect(ticketTiming({ dueBy: due, respondedAt: null, now: at(48) })).toBe('DUE_SOON');
    expect(ticketTiming({ dueBy: due, respondedAt: null, now: at(48.01) })).toBe('MISSED');
  });

  it('records whether the response came in time', () => {
    const now = new Date(reported.getTime() + 100 * H);
    expect(
      ticketTiming({ dueBy: due, respondedAt: new Date(reported.getTime() + 47 * H), now }),
    ).toBe('MET');
    expect(
      ticketTiming({ dueBy: due, respondedAt: new Date(reported.getTime() + 50 * H), now }),
    ).toBe('MET_LATE');
  });

  it('does not count a ticket cancelled before any response as missed', () => {
    const now = new Date(reported.getTime() + 100 * H);
    expect(ticketTiming({ dueBy: due, respondedAt: null, cancelled: true, now })).toBe('MET');
  });

  it('numbers tickets and certificates', () => {
    expect(ticketNumber(42)).toBe('VNS-000042');
    expect(certificateNumber('2026-27', 1)).toBe('VNC/2026-27/000001');
  });
});

describe('early-exit quote (D40, D44, spec rule 13)', () => {
  // Down payment paid; 6 instalments of ₹3,000 due on the 17th from Nov 2026.
  const schedule = (paid: number[]) => [
    { sequence: 0, dueDate: null, amount: 2_000_000, amountPaid: 2_000_000 },
    ...['2026-11-17', '2026-12-17', '2027-01-17', '2027-02-17', '2027-03-17', '2027-04-17'].map(
      (d, i) => ({
        sequence: i + 1,
        dueDate: d,
        amount: 300_000,
        amountPaid: paid[i] ?? 0,
      }),
    ),
  ];

  it('is every unpaid instalment in full, without deducting the down payment', () => {
    const q = earlyExitQuote({
      today: '2026-12-01',
      instalments: schedule([300_000, 0]),
      lateFees: [],
    });
    expect(q.remainingInstalments).toBe(1_500_000);
    expect(q.instalmentsLeft).toBe(5);
    expect(q.total).toBe(1_500_000);
    expect(q.notYetDue).toBe(5);
    expect(q.resultingState).toBe('EARLY_EXIT');
  });

  it('adds late fees already owed and counts part payments', () => {
    const q = earlyExitQuote({
      today: '2026-12-25',
      instalments: schedule([300_000, 100_000]),
      lateFees: [
        { amount: 10_000, amountPaid: 0 },
        { amount: 10_000, amountPaid: 10_000 },
      ],
    });
    expect(q.remainingInstalments).toBe(1_400_000);
    expect(q.lateFeesDue).toBe(10_000);
    expect(q.total).toBe(1_410_000);
  });

  it('is plain paid off when fewer than two instalments are still ahead (T34)', () => {
    const q = earlyExitQuote({
      today: '2027-03-20',
      instalments: schedule([300_000, 300_000, 300_000, 300_000, 300_000]),
      lateFees: [],
    });
    expect(q.notYetDue).toBe(1);
    expect(q.resultingState).toBe('PAID_OFF');
  });
});

describe('M4 permissions', () => {
  it('lets technicians and operations managers record service visits, not support', () => {
    expect(hasPermission('TECHNICIAN', 'tickets.resolve')).toBe(true);
    expect(hasPermission('OPERATIONS_MANAGER', 'tickets.resolve')).toBe(true);
    expect(hasPermission('SUPPORT', 'tickets.resolve')).toBe(false);
  });

  it('lets only operations managers and the super admin record ownership transfer', () => {
    expect(hasPermission('OPERATIONS_MANAGER', 'transfers.record')).toBe(true);
    expect(hasPermission('SUPER_ADMIN', 'transfers.record')).toBe(true);
    expect(hasPermission('FINANCE', 'transfers.record')).toBe(false);
    expect(hasPermission('PLAN_MANAGER', 'transfers.record')).toBe(false);
  });
});

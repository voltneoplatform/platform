import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  agreementNumber,
  buildSchedule,
  canTransition,
  completionState,
  firstDueDateProblem,
  installationDateProblem,
  ordinal,
  suggestFirstDueDate,
} from './agreements';
import { rupeesToPaise as r } from './money';

describe('dates', () => {
  it('adds months across year ends', () => {
    expect(addMonths('2026-11-17', 2)).toBe('2027-01-17');
    expect(addMonths('2026-12-02', 1)).toBe('2027-01-02');
    expect(addMonths('2027-01-02', 17)).toBe('2028-06-02');
  });

  it('adds days across month ends and leap years', () => {
    expect(addDays('2026-10-28', 7)).toBe('2026-11-04');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
  });

  it('writes ordinals', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 17, 21, 22, 102].map(ordinal)).toEqual([
      '1st',
      '2nd',
      '3rd',
      '4th',
      '11th',
      '12th',
      '13th',
      '17th',
      '21st',
      '22nd',
      '102nd',
    ]);
  });
});

describe('first due date (ASSUMED: at least 7 days ahead)', () => {
  it('suggests the next 2nd or 17th at least 7 days away', () => {
    expect(suggestFirstDueDate(17, '2026-10-23')).toBe('2026-11-17');
    expect(suggestFirstDueDate(2, '2026-10-23')).toBe('2026-11-02');
    expect(suggestFirstDueDate(17, '2026-10-10')).toBe('2026-10-17');
    expect(suggestFirstDueDate(17, '2026-10-11')).toBe('2026-11-17');
    expect(suggestFirstDueDate(2, '2026-12-28')).toBe('2027-02-02');
  });

  it('must be on the chosen day and within the allowed window', () => {
    expect(firstDueDateProblem('2026-11-17', 17, '2026-10-23')).toBeNull();
    expect(firstDueDateProblem('2026-11-02', 17, '2026-10-23')).toMatch(/17th/);
    expect(firstDueDateProblem('2026-10-29', 17, '2026-10-23')).toMatch(/2nd|17th/);
    expect(firstDueDateProblem('2026-11-02', 2, '2026-10-27')).toMatch(/at least 7 days/);
    expect(firstDueDateProblem('2027-02-02', 2, '2026-10-23')).toMatch(/within 75 days/);
  });

  it('needs installation at least 7 days before the first due date', () => {
    expect(installationDateProblem('2026-11-10', '2026-11-17')).toBeNull();
    expect(installationDateProblem('2026-11-11', '2026-11-17')).toMatch(/at least 7 days/);
  });
});

describe('schedule (Schedule 1 payment table)', () => {
  const s = buildSchedule({
    downPayment: r(20000),
    instalment: r(3000),
    termMonths: 18,
    firstDueDate: '2026-11-17',
  });

  it('lists the down payment, then one instalment a month', () => {
    expect(s.lines).toHaveLength(19);
    expect(s.lines[0]).toEqual({ sequence: 0, dueDate: null, amount: r(20000) });
    expect(s.lines[1]).toEqual({ sequence: 1, dueDate: '2026-11-17', amount: r(3000) });
    expect(s.lines[18]).toEqual({ sequence: 18, dueDate: '2028-04-17', amount: r(3000) });
  });

  it('matches the Foundation example total of ₹74,000', () => {
    expect(s.totalPayable).toBe(r(74000));
    expect(s.lastDueDate).toBe('2028-04-17');
  });

  it('refuses a first due date that is not the 2nd or 17th', () => {
    expect(() =>
      buildSchedule({ downPayment: 0, instalment: 100, termMonths: 2, firstDueDate: '2026-11-03' }),
    ).toThrow(/2nd or the 17th/);
  });
});

describe('agreement states (spec module 6)', () => {
  it('follows the signed → down payment → installation → active path', () => {
    expect(canTransition('DRAFT', 'AWAITING_DOWN_PAYMENT')).toBe(true);
    expect(canTransition('AWAITING_DOWN_PAYMENT', 'AWAITING_INSTALLATION')).toBe(true);
    expect(canTransition('AWAITING_INSTALLATION', 'ACTIVE')).toBe(true);
    expect(canTransition('ACTIVE', 'PAID_OFF')).toBe(true);
    expect(canTransition('PAID_OFF', 'TRANSFERRED')).toBe(true);
  });

  it('never skips installation or reopens a finished agreement', () => {
    expect(canTransition('AWAITING_DOWN_PAYMENT', 'ACTIVE')).toBe(false);
    expect(canTransition('AWAITING_INSTALLATION', 'CANCELLED')).toBe(false);
    expect(canTransition('TRANSFERRED', 'ACTIVE')).toBe(false);
    expect(canTransition('CANCELLED', 'DRAFT')).toBe(false);
  });

  it('calls it an early exit only when two or more instalments were not yet due', () => {
    const dates = ['2026-11-17', '2026-12-17', '2027-01-17'];
    expect(completionState('2026-12-01', dates)).toBe('EARLY_EXIT');
    expect(completionState('2026-12-17', dates)).toBe('PAID_OFF');
    expect(completionState('2027-01-10', dates)).toBe('PAID_OFF');
    expect(completionState('2026-11-01', ['2026-11-17'])).toBe('PAID_OFF');
  });

  it('numbers agreements', () => {
    expect(agreementNumber(123)).toBe('NOA-000123');
  });
});

import { describe, expect, it } from 'vitest';
import {
  collectionStage,
  finalNoticeDue,
  firstLateFeeDay,
  immobilisationApprovalAllowed,
  immobilisationRequestAllowed,
  lateFeeApplies,
  recoveryDueOn,
  reminderOffset,
  spellDay,
} from './collections';
import { NON_PAYMENT_POLICY } from './plans';

const policy = NON_PAYMENT_POLICY; // 5 days' grace, ₹100 a day, 30 days per spell
const due = '2026-11-17';

describe('reminders (D41)', () => {
  it('fire 5, 3 and 1 day before and on the due date only', () => {
    expect(reminderOffset(due, '2026-11-12')).toBe(5);
    expect(reminderOffset(due, '2026-11-14')).toBe(3);
    expect(reminderOffset(due, '2026-11-16')).toBe(1);
    expect(reminderOffset(due, '2026-11-17')).toBe(0);
    expect(reminderOffset(due, '2026-11-13')).toBeNull();
    expect(reminderOffset(due, '2026-11-18')).toBeNull();
  });
});

describe('the non-payment timeline (D33)', () => {
  it('counts the due date as day 0', () => {
    expect(spellDay(due, '2026-11-18')).toBe(1);
    expect(spellDay(due, '2026-11-22')).toBe(5);
  });

  it('sends the final notice from day 5', () => {
    expect(finalNoticeDue(due, '2026-11-21', policy)).toBe(false);
    expect(finalNoticeDue(due, '2026-11-22', policy)).toBe(true);
  });

  it('allows the request on day 5 and the approval from day 6', () => {
    expect(immobilisationRequestAllowed(due, '2026-11-22', policy)).toBe(true);
    expect(immobilisationApprovalAllowed(due, '2026-11-22', policy)).toBe(false);
    expect(immobilisationApprovalAllowed(due, '2026-11-23', policy)).toBe(true);
    expect(firstLateFeeDay(due, policy)).toBe('2026-11-23');
  });

  it('puts recovery 30 days after the battery was disabled (D39)', () => {
    expect(recoveryDueOn('2026-11-23', 30)).toBe('2026-12-23');
  });
});

describe('late fee (D38: ₹100 a day, at most 30 days per late spell)', () => {
  const base = { spellStartedOn: due, instalmentOverdue: true, policy, feeDaysAlreadyCharged: 0 };

  it('starts on day 6', () => {
    expect(lateFeeApplies({ ...base, today: '2026-11-22' })).toBe(false);
    expect(lateFeeApplies({ ...base, today: '2026-11-23' })).toBe(true);
  });

  it('stops after 30 days in the spell', () => {
    expect(lateFeeApplies({ ...base, today: '2027-01-30', feeDaysAlreadyCharged: 29 })).toBe(true);
    expect(lateFeeApplies({ ...base, today: '2027-01-31', feeDaysAlreadyCharged: 30 })).toBe(false);
  });

  it('needs an overdue instalment, and never applies at a zero rate', () => {
    expect(lateFeeApplies({ ...base, today: '2026-11-30', instalmentOverdue: false })).toBe(false);
    expect(
      lateFeeApplies({
        ...base,
        today: '2026-11-30',
        policy: { ...policy, lateFeePerDayPaise: 0 },
      }),
    ).toBe(false);
  });
});

describe('collections queue stage', () => {
  const s = (over: Partial<Parameters<typeof collectionStage>[0]>) =>
    collectionStage({
      today: '2026-11-20',
      policy,
      recoveryAfterDays: 30,
      spellStartedOn: due,
      immobilisedOn: null,
      restoreDue: false,
      immobilisationRequest: null,
      recoveryRequest: null,
      ...over,
    });

  it('moves from grace to final notice to due for immobilisation', () => {
    expect(s({})).toBe('GRACE');
    expect(s({ today: '2026-11-22' })).toBe('FINAL_NOTICE');
    expect(s({ today: '2026-11-23' })).toBe('DUE_FOR_IMMOBILISATION');
    expect(s({ spellStartedOn: null })).toBeNull();
  });

  it('follows the two-person immobilisation and recovery steps', () => {
    expect(s({ today: '2026-11-23', immobilisationRequest: 'PENDING' })).toBe(
      'IMMOBILISATION_REQUESTED',
    );
    expect(s({ today: '2026-11-23', immobilisationRequest: 'APPROVED' })).toBe('AWAITING_DISABLE');
    expect(s({ today: '2026-11-25', immobilisedOn: '2026-11-24' })).toBe('IMMOBILISED');
    expect(s({ today: '2026-12-24', immobilisedOn: '2026-11-24' })).toBe('DUE_FOR_RECOVERY');
    expect(
      s({ today: '2026-12-24', immobilisedOn: '2026-11-24', recoveryRequest: 'PENDING' }),
    ).toBe('RECOVERY_REQUESTED');
    expect(
      s({ today: '2026-12-24', immobilisedOn: '2026-11-24', recoveryRequest: 'APPROVED' }),
    ).toBe('AWAITING_COLLECTION');
  });

  it('puts a paid, still-disabled battery first', () => {
    expect(s({ immobilisedOn: '2026-11-24', restoreDue: true })).toBe('RESTORE_DUE');
  });
});

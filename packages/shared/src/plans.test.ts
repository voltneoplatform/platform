import { describe, expect, it } from 'vitest';
import {
  checkPrice,
  costFloor,
  planCode,
  planNameKey,
  planNameProblems,
  totalPayable,
} from './plans';
import { rupeesToPaise as r } from './money';

const basis = (purchase: number, extra = 0) => ({
  purchaseCost: r(purchase),
  gpsCost: r(extra),
  serviceCost: 0,
  financingCost: 0,
  collectionCost: 0,
  expectedLossCost: 0,
});

describe('total payable', () => {
  it('matches the Foundation example: ₹20,000 + 18 × ₹3,000 = ₹74,000', () => {
    expect(totalPayable(r(20000), r(3000), 18)).toBe(r(74000));
  });

  it('allows a zero down payment', () => {
    expect(totalPayable(0, r(3000), 24)).toBe(r(72000));
  });

  it('rejects a term below one month or not whole', () => {
    expect(() => totalPayable(0, r(100), 0)).toThrow(RangeError);
    expect(() => totalPayable(0, r(100), 1.5)).toThrow(RangeError);
  });
});

describe('cost floor (PROPOSED: purchase cost plus allowances)', () => {
  it('adds every component', () => {
    expect(
      costFloor({
        purchaseCost: r(50000),
        gpsCost: r(3000),
        serviceCost: r(4000),
        financingCost: r(6000),
        collectionCost: r(2000),
        expectedLossCost: r(5000),
      }),
    ).toBe(r(70000));
  });

  it('is never below the purchase cost', () => {
    expect(costFloor(basis(50000))).toBe(r(50000));
  });

  it('refuses negative allowances', () => {
    expect(() => costFloor({ ...basis(50000), gpsCost: -1 })).toThrow(/cannot be negative/);
  });

  it('passes a price exactly on the floor and fails one paisa below', () => {
    const on = checkPrice({
      batteryTypeId: 't',
      downPayment: r(20000),
      instalment: r(3000),
      termMonths: 18,
      basis: basis(74000),
    });
    expect(on).toMatchObject({ passes: true, margin: 0 });
    const below = checkPrice({
      batteryTypeId: 't',
      downPayment: r(20000) - 1,
      instalment: r(3000),
      termMonths: 18,
      basis: basis(74000),
    });
    expect(below).toMatchObject({ passes: false, margin: -1 });
  });
});

describe('plan names (D27)', () => {
  const ok = { bn: 'সহজ শুরু', hi: 'आसान शुरुआत', en: 'Easy Start' };

  it('accepts names in all three languages', () => {
    expect(planNameProblems(ok)).toEqual([]);
  });

  it('needs all three languages before a plan can exist', () => {
    expect(planNameProblems({ en: 'Easy Start' })).toEqual([
      'Bengali name is required',
      'Hindi name is required',
    ]);
  });

  it('limits length so names fit on a phone screen', () => {
    expect(planNameProblems({ ...ok, en: 'x'.repeat(33) })[0]).toMatch(/32 characters/);
    expect(planNameProblems({ ...ok, bn: 'স'.repeat(32) })).toEqual([]);
  });

  it('blocks unsupported claims in any language, as whole words in English', () => {
    expect(planNameProblems({ ...ok, en: 'Cheapest Plan' })[0]).toMatch(/cheapest/);
    expect(planNameProblems({ ...ok, en: 'Guaranteed Savings' })[0]).toMatch(/guarantee/);
    expect(planNameProblems({ ...ok, hi: 'सबसे सस्ता प्लान' })[0]).toMatch(/unsupported/);
    expect(planNameProblems({ ...ok, en: 'Freedom Plan' })).toEqual([]);
  });

  it('compares names ignoring case and extra spaces', () => {
    expect(planNameKey('  Easy   Start ')).toBe(planNameKey('easy start'));
  });

  it('makes fixed internal codes', () => {
    expect(planCode(3)).toBe('NO-P03');
    expect(planCode(112)).toBe('NO-P112');
  });
});

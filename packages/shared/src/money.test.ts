import { describe, expect, it } from 'vitest';
import { formatRupees, rupeesToPaise, sumPaise } from './money';
import { normaliseIndianMobile, parseLoginIdentifier } from './auth';

describe('money in paise', () => {
  it('converts rupees to whole paise', () => {
    expect(rupeesToPaise(3000)).toBe(300000);
    expect(rupeesToPaise(0.1 + 0.2)).toBe(30);
  });

  it('formats in Indian grouping', () => {
    expect(formatRupees(7400000)).toBe('₹74,000');
    expect(formatRupees(1250050)).toBe('₹12,500.50');
    expect(formatRupees(100000000)).toBe('₹10,00,000');
  });

  it('refuses fractional paise', () => {
    expect(() => sumPaise([100, 0.5])).toThrow(RangeError);
  });

  it('sums the Foundation example: ₹20,000 down + 18 × ₹3,000 = ₹74,000', () => {
    const total = sumPaise([rupeesToPaise(20000), ...Array(18).fill(rupeesToPaise(3000))]);
    expect(total).toBe(rupeesToPaise(74000));
  });
});

describe('login identifiers', () => {
  it('normalises Indian mobiles to +91', () => {
    expect(normaliseIndianMobile('98300 12345')).toBe('+919830012345');
    expect(normaliseIndianMobile('+91-9830012345')).toBe('+919830012345');
    expect(normaliseIndianMobile('09830012345')).toBe('+919830012345');
    expect(normaliseIndianMobile('5830012345')).toBeNull();
    expect(normaliseIndianMobile('983001234')).toBeNull();
  });

  it('recognises emails and lower-cases them', () => {
    expect(parseLoginIdentifier(' Ops@VoltNeo.in ')).toEqual({
      kind: 'email',
      value: 'ops@voltneo.in',
    });
    expect(parseLoginIdentifier('9830012345')).toEqual({ kind: 'phone', value: '+919830012345' });
    expect(parseLoginIdentifier('not an id')).toBeNull();
  });
});

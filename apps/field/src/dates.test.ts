import { describe, expect, it } from 'vitest';
import { dmyToIso, isoToDmy, typeDate } from './dates';

describe('DD-MM-YYYY dates', () => {
  it('adds dashes while typing', () => {
    expect(typeDate('1')).toBe('1');
    expect(typeDate('150')).toBe('15-0');
    expect(typeDate('15011990')).toBe('15-01-1990');
    expect(typeDate('15/01/1990 extra')).toBe('15-01-1990');
  });
  it('turns a real date into YYYY-MM-DD and refuses impossible ones', () => {
    expect(dmyToIso('15-01-1990')).toBe('1990-01-15');
    expect(dmyToIso('29-02-2000')).toBe('2000-02-29');
    expect(dmyToIso('29-02-2001')).toBeNull();
    expect(dmyToIso('31-04-1990')).toBeNull();
    expect(dmyToIso('15-1-1990')).toBeNull();
  });
  it('shows a stored date as DD-MM-YYYY', () => {
    expect(isoToDmy('1990-01-15')).toBe('15-01-1990');
    expect(isoToDmy(null)).toBe('');
  });
});

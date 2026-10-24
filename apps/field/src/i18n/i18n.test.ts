import { describe, expect, it } from 'vitest';
import { en } from './en';
import { LANGS, MESSAGES, hoursMinutes, rupees, shortDate, translate } from './index';
import { LABELS } from './labels';

describe('Field App wording', () => {
  it('has every message in Bengali and Hindi, with the same placeholders', () => {
    for (const lang of LANGS) {
      const m = MESSAGES[lang];
      expect(Object.keys(m).sort()).toEqual(Object.keys(en).sort());
      for (const key of Object.keys(en) as (keyof typeof en)[]) {
        const want = (en[key].match(/\{\w+\}/g) ?? []).sort();
        const got = (m[key].match(/\{\w+\}/g) ?? []).sort();
        expect({ key, lang, got }).toEqual({ key, lang, got: want });
        expect(m[key].trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('has every label in every language', () => {
    for (const lang of LANGS) {
      for (const group of Object.keys(LABELS.EN) as (keyof typeof LABELS.EN)[]) {
        expect(Object.keys(LABELS[lang][group]).sort()).toEqual(
          Object.keys(LABELS.EN[group]).sort(),
        );
      }
    }
  });

  it('fills in values', () => {
    expect(translate('EN', 'hello', { name: 'Rakesh' })).toBe('Hello, Rakesh');
    expect(translate('BN', 'agreement', { number: 'NOA-000001' })).toBe('চুক্তি NOA-000001');
  });

  it('formats money and dates the Indian way without the phone’s locale data', () => {
    expect(rupees(12345600)).toBe('₹1,23,456');
    expect(rupees(150050)).toBe('₹1,500.50');
    expect(rupees(99)).toBe('₹0.99');
    expect(rupees(100000000)).toBe('₹10,00,000');
    expect(shortDate('2026-11-17')).toBe('17/11/2026');
    expect(shortDate('2026-10-24T18:45:00Z', true)).toBe('25/10/2026 00:15');
    expect(hoursMinutes(5 * 3_600_000 + 20 * 60_000)).toBe('5 h 20 min');
    expect(hoursMinutes(-45 * 60_000)).toBe('45 min');
  });
});

import { parseRupees } from '../money';

describe('typed amounts', () => {
  it('reads rupees as paise', () => {
    expect(parseRupees('1500')).toBe(150000);
    expect(parseRupees('1,500.5')).toBe(150050);
    expect(parseRupees('₹ 99.99')).toBe(9999);
    expect(parseRupees('')).toBeNull();
    expect(parseRupees('12.345')).toBeNull();
    expect(parseRupees('abc')).toBeNull();
  });
});

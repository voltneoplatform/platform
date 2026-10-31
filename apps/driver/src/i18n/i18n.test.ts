import { describe, expect, it } from 'vitest';
import { en } from './en';
import { LANGS, MESSAGES, rupees, shortDate, translate } from './index';
import { LABELS } from './labels';

describe('Driver App wording', () => {
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

  it('fills in values and formats money the Indian way', () => {
    expect(translate('EN', 'payButton', { amount: rupees(300000) })).toBe('Pay ₹3,000 by UPI');
    expect(translate('BN', 'agreementNo', { number: 'NOA-000001' })).toBe('চুক্তি NOA-000001');
    expect(rupees(12345600)).toBe('₹1,23,456');
    expect(shortDate('2026-11-17')).toBe('17/11/2026');
  });
});

import { describe, expect, it } from 'vitest';
import { amountInWords, numberInWords } from './words';
import { rupeesToPaise as r } from './money';

describe('amounts in words (Indian system)', () => {
  it('writes English with lakh and crore', () => {
    expect(numberInWords(74000, 'EN')).toBe('seventy-four thousand');
    expect(numberInWords(120500, 'EN')).toBe('one lakh twenty thousand five hundred');
    expect(numberInWords(25_03_00_011, 'EN')).toBe('twenty-five crore three lakh eleven');
    expect(numberInWords(0, 'EN')).toBe('zero');
  });

  it('writes the cheque form with paise', () => {
    expect(amountInWords(r(74000), 'EN')).toBe('Rupees seventy-four thousand only');
    expect(amountInWords(r(3000) + 50, 'EN')).toBe('Rupees three thousand and fifty paise only');
  });

  it('writes Hindi and Bengali (to be checked by a native speaker)', () => {
    expect(amountInWords(r(74000), 'HI')).toBe('चौहत्तर हज़ार रुपये मात्र');
    expect(amountInWords(r(74000), 'BN')).toBe('চুয়াত্তর হাজার টাকা মাত্র');
    expect(numberInWords(20500, 'HI')).toBe('बीस हज़ार पाँच सौ');
    expect(numberInWords(20500, 'BN')).toBe('কুড়ি হাজার পাঁচ শত');
  });

  it('refuses negative or fractional amounts', () => {
    expect(() => amountInWords(-1, 'EN')).toThrow(RangeError);
    expect(() => numberInWords(1.5, 'EN')).toThrow(RangeError);
  });
});

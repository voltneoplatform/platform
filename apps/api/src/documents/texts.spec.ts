import { describe, expect, it } from 'vitest';
import { COMPUTER_GENERATED, TEXTS } from './texts';

describe('receipt wording', () => {
  it('says in every language, and always in English, that no signature is needed', () => {
    expect(COMPUTER_GENERATED).toBe(
      'This is a computer-generated receipt and does not require a signature.',
    );
    for (const lang of ['EN', 'BN', 'HI'] as const) {
      expect(TEXTS[lang].receiptComputerGenerated).toContain(COMPUTER_GENERATED);
    }
  });
});

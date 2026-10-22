import { generateOtpCode, generateRefreshToken, hashOtp, safeEqualHex } from './crypto';

describe('auth crypto', () => {
  it('generates 6-digit codes including leading zeros', () => {
    for (let i = 0; i < 500; i++) expect(generateOtpCode()).toMatch(/^\d{6}$/);
  });

  it('binds a code hash to its challenge', () => {
    const a = hashOtp('secret', 'challenge-1', '123456');
    expect(hashOtp('secret', 'challenge-1', '123456')).toBe(a);
    expect(hashOtp('secret', 'challenge-2', '123456')).not.toBe(a);
    expect(hashOtp('other', 'challenge-1', '123456')).not.toBe(a);
  });

  it('compares hashes safely, including different lengths', () => {
    expect(safeEqualHex('abcd', 'abcd')).toBe(true);
    expect(safeEqualHex('abcd', 'abce')).toBe(false);
    expect(safeEqualHex('abcd', 'abcdef')).toBe(false);
  });

  it('makes long, unique refresh tokens', () => {
    const t = generateRefreshToken();
    expect(t.length).toBeGreaterThanOrEqual(43);
    expect(generateRefreshToken()).not.toBe(t);
  });
});

import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/** A uniformly random 6-digit code, including leading zeros. */
export function generateOtpCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

/** Codes are bound to their challenge, so a hash cannot be reused for another login. */
export function hashOtp(secret: string, challengeId: string, code: string): string {
  return createHmac('sha256', secret).update(`${challengeId}:${code}`).digest('hex');
}

export function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function generateRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Refresh tokens are long and random, so a plain SHA-256 is enough to store them safely. */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

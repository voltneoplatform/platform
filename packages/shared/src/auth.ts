import type { Permission, Role } from './roles';

/** Staff login identifier: an email address or an Indian mobile number. */
export type LoginIdentifier = { kind: 'email'; value: string } | { kind: 'phone'; value: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Normalises what a user typed into an email or an E.164 Indian mobile number.
 * Returns null if it is neither.
 */
export function parseLoginIdentifier(raw: string): LoginIdentifier | null {
  const input = raw.trim();
  if (EMAIL_RE.test(input)) return { kind: 'email', value: input.toLowerCase() };
  const phone = normaliseIndianMobile(input);
  return phone ? { kind: 'phone', value: phone } : null;
}

/** Accepts 10-digit Indian mobiles with optional +91, 91 or 0 prefix. Returns +91XXXXXXXXXX. */
export function normaliseIndianMobile(raw: string): string | null {
  const digits = raw.replace(/[\s\-()]/g, '');
  const m = /^(?:\+91|91|0)?([6-9]\d{9})$/.exec(digits);
  return m ? `+91${m[1]}` : null;
}

export type StaffStatus = 'ACTIVE' | 'DEACTIVATED';

export interface StaffProfile {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: Role;
  status: StaffStatus;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface AuthSession {
  accessToken: string;
  /** Present for app clients. Web clients receive it as an httpOnly cookie instead. */
  refreshToken?: string;
  accessTokenExpiresAt: string;
  staff: StaffProfile;
  permissions: Permission[];
}

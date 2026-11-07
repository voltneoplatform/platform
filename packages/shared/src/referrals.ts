/**
 * Referrals (founder, 7 Nov 2026): a new driver may be referred by an existing
 * driver or by an outside person (a mechanic, shopkeeper, agent…). Tracking
 * only for now: who referred whom, and how many went on to get a battery.
 * Rewards are not calculated (REQUIRES VALIDATION: reward rules, if any).
 */

/** Driver ID shown to staff and used as a referral ID, e.g. VND-000012. */
export function driverCode(seq: number): string {
  return `VND-${String(seq).padStart(6, '0')}`;
}

/** Outside referrer ID, e.g. REF-000003. */
export function referrerCode(seq: number): string {
  return `REF-${String(seq).padStart(6, '0')}`;
}

export const REFERRER_KINDS = ['MECHANIC', 'SHOPKEEPER', 'DEALER', 'AGENT', 'OTHER'] as const;
export type ReferrerKind = (typeof REFERRER_KINDS)[number];

export const REFERRER_KIND_LABELS: Record<ReferrerKind, string> = {
  MECHANIC: 'Mechanic or garage',
  SHOPKEEPER: 'Shopkeeper',
  DEALER: 'Vehicle dealer',
  AGENT: 'Agent',
  OTHER: 'Other',
};

/** A referral as staff pick it: one of the two kinds of referrer, or none. */
export type ReferralRef = { driverId: string } | { referrerId: string } | null;

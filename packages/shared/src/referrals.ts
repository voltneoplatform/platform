/**
 * Referrals (founder, 7 Nov 2026): a new driver may be referred by an outside
 * person (a mechanic, shopkeeper, agent…), never by another driver. Head
 * office keeps the referrer list; field staff pick one when registering.
 * Tracking only: who referred whom, and how many went on to get a battery.
 * Rewards are not calculated (REQUIRES VALIDATION: reward rules, if any).
 */

/** Driver ID shown to staff, e.g. VND-000012. */
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

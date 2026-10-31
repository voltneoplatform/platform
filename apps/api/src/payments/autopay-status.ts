import type { AutopayStatus } from '../generated/prisma/enums';

/**
 * Our mandate status for the gateway's word (Cashfree subscription statuses:
 * INITIALIZED, BANK_APPROVAL_PENDING, ACTIVE, ON_HOLD, PAUSED, CUSTOMER_PAUSED,
 * CANCELLED, CUSTOMER_CANCELLED, COMPLETED, EXPIRED, LINK_EXPIRED). null = no change.
 * Paused and on-hold mandates stay ACTIVE here: their charges fail and the
 * usual reminders follow. REQUIRES VALIDATION against the sandbox.
 */
export function mandateStatusFor(gateway: string): {
  status: AutopayStatus;
  endedBy?: 'DRIVER_UPI' | 'GATEWAY';
} | null {
  switch (gateway.toUpperCase().replace(/ /g, '_')) {
    case 'ACTIVE':
      return { status: 'ACTIVE' };
    case 'CUSTOMER_CANCELLED':
      return { status: 'CANCELLED', endedBy: 'DRIVER_UPI' };
    case 'CANCELLED':
    case 'COMPLETED':
    case 'EXPIRED':
      return { status: 'CANCELLED', endedBy: 'GATEWAY' };
    case 'LINK_EXPIRED':
    case 'AUTH_FAILED':
      return { status: 'FAILED', endedBy: 'GATEWAY' };
    default:
      return null;
  }
}

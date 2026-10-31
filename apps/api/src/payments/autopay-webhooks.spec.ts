import { describe, expect, it } from 'vitest';
import { parseCashfreeEvent } from './webhooks.service';
import { mandateStatusFor } from './autopay-status';

describe('Cashfree UPI AutoPay events', () => {
  it('reads a mandate status change', () => {
    const e = parseCashfreeEvent({
      type: 'SUBSCRIPTION_STATUS_CHANGED',
      event_time: '2026-11-01T10:00:00+05:30',
      data: {
        subscription_details: { subscription_id: 'VNM_NOA-1_ab', subscription_status: 'ACTIVE' },
      },
    });
    expect(e).toMatchObject({ kind: 'mandate', subscriptionId: 'VNM_NOA-1_ab', status: 'ACTIVE' });
  });

  it('reads a charge taken, with its amount and transaction', () => {
    const e = parseCashfreeEvent({
      type: 'SUBSCRIPTION_PAYMENT_SUCCESS',
      event_time: '2026-11-17T11:00:00+05:30',
      data: {
        payment_id: 'VNC_NOA-1_1_abc',
        cf_payment_id: 991,
        subscription_id: 'VNM_NOA-1_ab',
        payment_amount: 3000,
        payment_status: 'SUCCESS',
        payment_type: 'CHARGE',
      },
    });
    expect(e).toMatchObject({
      kind: 'charge',
      chargeId: 'VNC_NOA-1_1_abc',
      status: 'SUCCESS',
      amountPaise: 300000,
      providerRef: '991',
    });
  });

  it('reads a failed charge with its reason, and ignores the approval payment', () => {
    expect(
      parseCashfreeEvent({
        type: 'SUBSCRIPTION_PAYMENT_FAILED',
        data: {
          payment_id: 'VNC_1',
          payment_status: 'FAILED',
          payment_type: 'CHARGE',
          failure_details: { failure_reason: 'Insufficient funds' },
        },
      }),
    ).toMatchObject({ kind: 'charge', status: 'FAILED', reason: 'Insufficient funds' });
    expect(
      parseCashfreeEvent({
        type: 'SUBSCRIPTION_PAYMENT_SUCCESS',
        data: { payment_id: 'auth_1', payment_status: 'SUCCESS', payment_type: 'AUTH' },
      }).kind,
    ).toBe('ignored');
  });

  it('maps gateway statuses to ours', () => {
    expect(mandateStatusFor('ACTIVE')).toEqual({ status: 'ACTIVE' });
    expect(mandateStatusFor('CUSTOMER_CANCELLED')).toEqual({
      status: 'CANCELLED',
      endedBy: 'DRIVER_UPI',
    });
    expect(mandateStatusFor('BANK_APPROVAL_PENDING')).toBeNull();
    expect(mandateStatusFor('ON_HOLD')).toBeNull();
  });
});

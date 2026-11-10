import {
  CashfreeGateway,
  istIso,
  localPhone,
  paiseToRupeeNumber,
  rupeesToPaiseExact,
} from './gateway';
import { parseCashfreeEvent } from './webhooks.service';

describe('payment gateway helpers', () => {
  it('converts rupee strings to paise exactly', () => {
    expect(rupeesToPaiseExact('200.12')).toBe(20012);
    expect(rupeesToPaiseExact('22')).toBe(2200);
    expect(rupeesToPaiseExact('0.1')).toBe(10);
    expect(rupeesToPaiseExact(1500.5)).toBe(150050);
    expect(() => rupeesToPaiseExact('1e3')).toThrow();
    expect(paiseToRupeeNumber(150050)).toBe(1500.5);
  });

  it('formats phones and India times for Cashfree', () => {
    expect(localPhone('+919876543210')).toBe('9876543210');
    expect(localPhone('9876543210')).toBe('9876543210');
    expect(istIso(new Date('2026-10-31T18:29:59Z'))).toBe('2026-10-31T23:59:59+05:30');
  });

  it('reads Cashfree link events', () => {
    const paid = parseCashfreeEvent({
      type: 'PAYMENT_LINK_EVENT',
      event_time: '2026-10-24T12:55:06+05:30',
      data: {
        cf_link_id: 1,
        link_id: 'VNL_X',
        link_status: 'PAID',
        order: { order_amount: '22.00', transaction_id: 99, transaction_status: 'SUCCESS' },
      },
    });
    expect(paid).toMatchObject({
      kind: 'payment',
      linkId: 'VNL_X',
      amountPaise: 2200,
      providerRef: '99',
      method: 'UPI',
      eventId: 'PAYMENT_LINK_EVENT:1:PAID:99',
    });
    expect(
      parseCashfreeEvent(
        { type: 'PAYMENT_LINK_EVENT', data: { link_id: 'VNL_X', link_status: 'CANCELLED' } },
        'key-1',
      ),
    ).toEqual({ kind: 'link_closed', eventId: 'key-1', linkId: 'VNL_X', status: 'CANCELLED' });
    expect(
      parseCashfreeEvent({
        type: 'PAYMENT_LINK_EVENT',
        data: {
          link_id: 'VNL_X',
          link_status: 'PAID',
          order: { order_amount: '22.00', transaction_status: 'FAILED' },
        },
      }).kind,
    ).toBe('ignored');
    expect(() => parseCashfreeEvent({ data: {} })).toThrow();
  });

  it('asks Cashfree for a mandate with a ₹1 refunded approval for UPI and e-NACH', async () => {
    const bodies: Record<string, unknown>[] = [];
    const gw = new CashfreeGateway(
      { env: 'sandbox', appId: 'TEST', secretKey: 'cfsk', apiVersion: '2026-01-01' },
      'https://api.example.in/v1/webhooks/payments/cashfree',
      async (_url, init) => {
        bodies.push(JSON.parse(String(init?.body)));
        return new Response(
          JSON.stringify({ subscription_session_id: 'sess', cf_subscription_id: 7 }),
          { status: 200 },
        );
      },
    );
    for (const method of ['UPI', 'ENACH'] as const) {
      await gw.createMandate({
        subscriptionId: `VNM_${method}`,
        customer: { phone: '+919876543210', name: 'Test Driver', email: 'd@example.in' },
        maxAmountPaise: 300000,
        method,
        agreementNumber: 'NOA-000001',
        expiresAt: new Date('2027-12-31T18:29:59Z'),
        returnUrl: 'https://api.example.in/autopay/abc/done',
      });
    }
    // Cashfree refuses an approval amount of 0, even for e-NACH (test site, 10 Nov 2026).
    expect(bodies.map((b) => b.authorization_details)).toEqual([
      { authorization_amount: 1, authorization_amount_refund: true, payment_methods: ['upi'] },
      { authorization_amount: 1, authorization_amount_refund: true, payment_methods: ['enach'] },
    ]);
  });
});

import { istIso, localPhone, paiseToRupeeNumber, rupeesToPaiseExact } from './gateway';
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
});

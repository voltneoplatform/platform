'use client';

import { useState } from 'react';
import { formatRupees } from '@voltneo/shared';
import { useSession } from '@/lib/session';
import { ErrorBox, Money, RupeeInput, formatDate, useLoad } from '@/components/ui';

export interface PaymentLinkRow {
  id: string;
  linkId: string;
  gateway: string;
  url: string;
  amount: number;
  status: 'ACTIVE' | 'PAID' | 'EXPIRED' | 'CANCELLED';
  expiresAt: string;
  paymentId: string | null;
  closedAt: string | null;
  closedNote: string | null;
  createdAt: string;
  createdByName: string | null;
}

interface LinkList {
  gateway: 'cashfree' | 'fake' | 'none';
  canSimulate: boolean;
  items: PaymentLinkRow[];
}

const STATUS: Record<PaymentLinkRow['status'], { label: string; tone: string }> = {
  ACTIVE: { label: 'Open', tone: 'info' },
  PAID: { label: 'Paid', tone: 'active' },
  EXPIRED: { label: 'Expired', tone: '' },
  CANCELLED: { label: 'Cancelled', tone: '' },
};

/** UPI payment links sent by SMS (M5, Cashfree). */
export function PaymentLinksCard({
  agreementId,
  suggested,
  max,
  canSend,
  onPaid,
}: {
  agreementId: string;
  /** Amount to offer first (what is overdue, or the next instalment). */
  suggested: number;
  max: number;
  canSend: boolean;
  onPaid: () => void;
}) {
  const { api, can } = useSession();
  const { data, error, setData } = useLoad(
    () => api.get<LinkList>(`/v1/agreements/${agreementId}/payment-links`),
    [api, agreementId],
  );
  const [amount, setAmount] = useState<number | null>(suggested > 0 ? suggested : null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<unknown>(null);
  const [message, setMessage] = useState<string | null>(null);
  const mayAct = can('payments.record') || can('payments.collect_cash');

  if (!data) return <ErrorBox error={error} />;
  if (!data.items.length && !(canSend && mayAct)) return null;

  async function act(fn: () => Promise<LinkList>, done: string) {
    setBusy(true);
    setActionError(null);
    setMessage(null);
    try {
      setData(await fn());
      setMessage(done);
    } catch (err) {
      setActionError(err);
    } finally {
      setBusy(false);
    }
  }

  const open = data.items.find((l) => l.status === 'ACTIVE');

  return (
    <div className="card">
      <h2>UPI payment links</h2>
      {data.gateway === 'fake' && (
        <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
          Test mode: links are pretend until the Cashfree keys are added.
        </p>
      )}
      {data.gateway === 'none' && (
        <div className="alert warn">
          Not set up yet: the Cashfree keys still need to be added to the server settings.
        </div>
      )}
      {message && <div className="alert success">{message}</div>}
      <ErrorBox error={actionError} />
      {canSend && mayAct && data.gateway !== 'none' && (
        <form
          className="row"
          style={{ alignItems: 'flex-end', marginBottom: 12 }}
          onSubmit={(e) => {
            e.preventDefault();
            if (!amount) return;
            void act(
              () =>
                api.post<LinkList>(`/v1/agreements/${agreementId}/payment-links`, {
                  amountPaise: amount,
                }),
              open
                ? 'New link sent by SMS. The earlier link no longer works.'
                : 'Link sent to the driver by SMS.',
            );
          }}
        >
          <div className="field" style={{ marginBottom: 0, maxWidth: 200 }}>
            <label htmlFor="pl-amount">Amount (up to {formatRupees(max)})</label>
            <RupeeInput
              id="pl-amount"
              value={amount}
              onChange={setAmount}
              required
              allowZero={false}
            />
          </div>
          <button type="submit" className="primary" disabled={busy || !amount}>
            {open ? 'Send a new link' : 'Send UPI link by SMS'}
          </button>
        </form>
      )}
      {data.items.length > 0 && (
        <ul className="timeline">
          {data.items.map((l) => (
            <li key={l.id}>
              <Money paise={l.amount} />{' '}
              <span className={`badge ${STATUS[l.status].tone}`}>{STATUS[l.status].label}</span>{' '}
              <span className="muted" style={{ fontSize: 13 }}>
                sent {formatDate(l.createdAt, true)}
                {l.createdByName && ` by ${l.createdByName}`}
                {l.status === 'ACTIVE' && ` · open until ${formatDate(l.expiresAt, true)}`}
                {l.closedNote && l.status !== 'PAID' && ` · ${l.closedNote}`}
              </span>
              {l.status === 'ACTIVE' && mayAct && (
                <div className="row" style={{ marginTop: 6 }}>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void act(
                        () => api.post<LinkList>(`/v1/payment-links/${l.id}/resend`),
                        'SMS sent again.',
                      )
                    }
                  >
                    Send SMS again
                  </button>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void act(
                        () => api.post<LinkList>(`/v1/payment-links/${l.id}/cancel`),
                        'Link cancelled.',
                      )
                    }
                  >
                    Cancel link
                  </button>
                  {data.canSimulate && can('payments.record') && (
                    <button
                      disabled={busy}
                      onClick={() =>
                        void act(async () => {
                          const r = await api.post<{ links: LinkList }>(
                            `/v1/payment-links/${l.id}/simulate-paid`,
                          );
                          onPaid();
                          return r.links;
                        }, 'Marked paid (test mode). The payment and receipt are recorded.')
                      }
                    >
                      Mark paid (test only)
                    </button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

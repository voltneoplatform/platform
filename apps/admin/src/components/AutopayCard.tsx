'use client';

import { useState } from 'react';
import { useSession } from '@/lib/session';
import { ErrorBox, Money, formatDate, useLoad } from '@/components/ui';

interface Charge {
  id: string;
  amount: number;
  scheduledFor: string;
  status: 'SCHEDULED' | 'NOTIFIED' | 'SUCCESS' | 'FAILED' | 'CANCELLED';
  failureReason: string | null;
  paymentId: string | null;
  createdAt: string;
}

interface AutopayView {
  available: boolean;
  canSimulate: boolean;
  unavailableReason: string | null;
  mandate: {
    id: string;
    method: 'UPI' | 'ENACH';
    status: 'PENDING' | 'ACTIVE' | 'CANCELLED' | 'FAILED';
    gatewayStatus: string | null;
    maxAmount: number;
    statusNote: string | null;
    createdAt: string;
    activatedAt: string | null;
    endedAt: string | null;
    endedBy: string | null;
    approvalUrl: string | null;
    charges: Charge[];
  } | null;
}

const MANDATE: Record<string, { label: string; tone: string }> = {
  PENDING: { label: 'Waiting for the driver to approve', tone: 'info' },
  ACTIVE: { label: 'On', tone: 'active' },
  CANCELLED: { label: 'Off', tone: '' },
  FAILED: { label: 'Not set up', tone: '' },
};

const CHARGE: Record<Charge['status'], { label: string; tone: string }> = {
  SCHEDULED: { label: 'Scheduled', tone: 'info' },
  NOTIFIED: { label: 'Driver notified', tone: 'info' },
  SUCCESS: { label: 'Taken', tone: 'active' },
  FAILED: { label: 'Failed', tone: 'danger' },
  CANCELLED: { label: 'Cancelled', tone: '' },
};

const ENDED_BY: Record<string, string> = {
  DRIVER: 'the driver, in the Driver App',
  DRIVER_UPI: 'the driver, in their UPI app',
  STAFF: 'head office',
  SYSTEM: 'the system',
  GATEWAY: 'the bank or gateway',
};

/**
 * UPI AutoPay (M6): the driver switches it on in the Driver App; head office
 * sees its state and the charges, and can switch it off.
 */
export function AutopayCard({
  agreementId,
  onChange,
}: {
  agreementId: string;
  onChange: () => void;
}) {
  const { api, can } = useSession();
  const { data, error, setData } = useLoad(
    () => api.get<AutopayView>(`/v1/agreements/${agreementId}/autopay`),
    [api, agreementId],
  );
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<unknown>(null);
  const mayAct = can('payments.record') || can('collections.assign');

  if (!data) return <ErrorBox error={error} />;
  const m = data.mandate;
  if (!m && !data.available) return null;

  async function act(fn: () => Promise<AutopayView>) {
    setBusy(true);
    setActionError(null);
    try {
      setData(await fn());
      onChange();
    } catch (err) {
      setActionError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2>AutoPay (UPI or e-NACH)</h2>
      {!m ? (
        <p className="muted" style={{ marginTop: 0 }}>
          Off. The driver can switch it on in the Driver App, by UPI or e-NACH (up to one instalment
          a month).
        </p>
      ) : (
        <>
          <p style={{ marginTop: 0 }}>
            <strong>{m.method === 'ENACH' ? 'e-NACH (bank account)' : 'UPI AutoPay'}</strong>{' '}
            <span className={`badge ${MANDATE[m.status]!.tone}`}>{MANDATE[m.status]!.label}</span>{' '}
            <span className="muted" style={{ fontSize: 13 }}>
              up to <Money paise={m.maxAmount} /> a charge
              {m.activatedAt && ` · on since ${formatDate(m.activatedAt, true)}`}
              {m.endedAt &&
                ` · ended ${formatDate(m.endedAt, true)}${m.endedBy ? ` by ${ENDED_BY[m.endedBy] ?? m.endedBy}` : ''}`}
              {m.statusNote && ` · ${m.statusNote}`}
              {m.gatewayStatus && ` · gateway: ${m.gatewayStatus}`}
            </span>
          </p>
          <ErrorBox error={actionError} />
          {(m.status === 'ACTIVE' || m.status === 'PENDING') && mayAct && (
            <div className="row" style={{ marginBottom: 12 }}>
              <button
                disabled={busy}
                onClick={() => {
                  const reason = window.prompt('Why is AutoPay being switched off?') ?? '';
                  if (!reason.trim()) return;
                  void act(() =>
                    api.post<AutopayView>(`/v1/agreements/${agreementId}/autopay/cancel`, {
                      reason: reason.trim(),
                    }),
                  );
                }}
              >
                Switch AutoPay off
              </button>
              {m.status === 'PENDING' && data.canSimulate && (
                <button
                  disabled={busy}
                  onClick={() =>
                    void act(() =>
                      api.post<AutopayView>(`/v1/autopay/mandates/${m.id}/simulate`, {
                        status: 'ACTIVE',
                      }),
                    )
                  }
                  title="Test server only"
                >
                  Simulate approval (test)
                </button>
              )}
            </div>
          )}
          {m.charges.length > 0 && (
            <ul className="timeline">
              {m.charges.map((c) => (
                <li key={c.id}>
                  <Money paise={c.amount} />{' '}
                  <span className={`badge ${CHARGE[c.status].tone}`}>{CHARGE[c.status].label}</span>{' '}
                  <span className="muted" style={{ fontSize: 13 }}>
                    for {formatDate(c.scheduledFor)}
                    {c.failureReason && ` · ${c.failureReason}`}
                  </span>
                  {(c.status === 'SCHEDULED' || c.status === 'NOTIFIED') &&
                    mayAct &&
                    data.canSimulate && (
                      <span className="row" style={{ marginTop: 6 }}>
                        <button
                          disabled={busy}
                          title="Test server only"
                          onClick={() =>
                            void act(() =>
                              api.post<AutopayView>(`/v1/autopay/charges/${c.id}/simulate`, {
                                status: 'SUCCESS',
                              }),
                            )
                          }
                        >
                          Simulate taken (test)
                        </button>
                      </span>
                    )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

'use client';

import { useState } from 'react';
import {
  AGREEMENT_STATE_LABELS,
  PAYMENT_METHOD_LABELS,
  formatRupees,
  hasPermission,
  type AgreementState,
  type PaymentMethod,
} from '@voltneo/shared';
import { useSession } from '@/lib/session';
import type { PaymentRow, StaffDirectoryRow } from '@/lib/types';
import { ErrorBox, RupeeInput, formatDate } from '@/components/ui';

const STATE_TONE: Record<string, string> = {
  DRAFT: '',
  AWAITING_DOWN_PAYMENT: 'warn',
  AWAITING_INSTALLATION: 'warn',
  ACTIVE: 'active',
  IN_GRACE: 'warn',
  IMMOBILISED: 'deactivated',
  RECOVERED: 'warn',
  CLOSED: '',
  PAID_OFF: 'info',
  EARLY_EXIT: 'info',
  TRANSFERRED: 'info',
  CANCELLED: '',
};

export function AgreementStateBadge({ state }: { state: string }) {
  return (
    <span className={`badge ${STATE_TONE[state] ?? ''}`}>
      {AGREEMENT_STATE_LABELS[state as AgreementState] ?? state}
    </span>
  );
}

/**
 * Opens a file fetched with the login token (a generated PDF) in a new tab.
 * The tab is opened first so pop-up blockers allow it.
 */
export async function openBlob(get: () => Promise<Blob>) {
  const w = window.open('', '_blank');
  try {
    const blob = await get();
    const url = URL.createObjectURL(blob);
    if (w) w.location.href = url;
    else window.location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (err) {
    w?.close();
    throw err;
  }
}

/** Opens a short-lived signed file link in a new tab. */
export async function openLink(get: () => Promise<{ url: string }>) {
  const w = window.open('', '_blank');
  try {
    const { url } = await get();
    if (w) w.location.href = url;
    else window.location.href = url;
  } catch (err) {
    w?.close();
    throw err;
  }
}

/** Current time as a value for <input type="datetime-local"> in the browser's time zone. */
export function nowLocal(): string {
  const d = new Date();
  d.setSeconds(0, 0);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function localToIso(v: string): string {
  return new Date(v).toISOString();
}

export function allocationLabel(a: PaymentRow['allocations'][number]): string {
  switch (a.kind) {
    case 'DOWN_PAYMENT':
      return 'Down payment';
    case 'INSTALMENT':
      return `Instalment ${a.sequence}`;
    case 'LATE_FEE':
      return a.lateFeeDate ? `Late fee ${formatDate(a.lateFeeDate)}` : 'Late fee';
    default:
      return 'Overpaid (to refund)';
  }
}

export function MessageStatus({ messages }: { messages: PaymentRow['messages'] }) {
  const last = messages.at(-1);
  if (!last) return <span className="muted">—</span>;
  const tone =
    last.status === 'SENT' ? 'active' : last.status === 'FAILED' ? 'deactivated' : 'warn';
  return (
    <span className={`badge ${tone}`} title={last.error ?? undefined}>
      {last.channel} {last.status.toLowerCase()}
    </span>
  );
}

/** Record a payment against an agreement (spec module 8). */
export function PaymentForm({
  agreementId,
  maxHint,
  staff,
  onDone,
}: {
  agreementId: string;
  maxHint: number;
  staff: StaffDirectoryRow[];
  onDone: (p: PaymentRow) => void;
}) {
  const { api, can, staff: me } = useSession();
  const canRecord = can('payments.record');
  const canCash = can('payments.collect_cash');
  const [method, setMethod] = useState<PaymentMethod>(canRecord ? 'UPI' : 'CASH');
  const [amount, setAmount] = useState<number | null>(null);
  const [reference, setReference] = useState('');
  const [receivedAt, setReceivedAt] = useState(nowLocal());
  const [collectedById, setCollectedById] = useState(me?.id ?? '');
  const [note, setNote] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  // One ID per form, so a double-click or a retried request is counted once.
  const [requestId] = useState(() => crypto.randomUUID());

  const collectors = staff.filter((s) => hasPermission(s.role, 'payments.collect_cash'));
  const methods = (['UPI', 'CARD', 'CASH'] as const).filter((m) =>
    m === 'CASH' ? canCash : canRecord,
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!amount) return;
    setBusy(true);
    setError(null);
    try {
      const p = await api.post<PaymentRow>('/v1/payments', {
        agreementId,
        amountPaise: amount,
        method,
        reference: method === 'CASH' ? undefined : reference,
        receivedAt: localToIso(receivedAt),
        collectedById: method === 'CASH' ? collectedById || undefined : undefined,
        note: note || undefined,
        clientRequestId: requestId,
      });
      onDone(p);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <p className="muted">
        Payments go to late fees first, then the oldest unpaid instalment (clause B10). Up to{' '}
        {formatRupees(maxHint)} can be received now. The driver gets an SMS receipt.
      </p>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="pay-amount">Amount</label>
          <RupeeInput
            id="pay-amount"
            value={amount}
            onChange={setAmount}
            required
            allowZero={false}
          />
        </div>
        <div className="field">
          <label htmlFor="pay-method">Paid by</label>
          <select
            id="pay-method"
            value={method}
            onChange={(e) => setMethod(e.target.value as PaymentMethod)}
          >
            {methods.map((m) => (
              <option key={m} value={m}>
                {PAYMENT_METHOD_LABELS[m]}
              </option>
            ))}
          </select>
        </div>
        {method !== 'CASH' ? (
          <div className="field">
            <label htmlFor="pay-ref">
              {method === 'UPI' ? 'UPI transaction ID (UTR)' : 'Card approval code'}
            </label>
            <input
              id="pay-ref"
              required
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              minLength={4}
              maxLength={64}
            />
          </div>
        ) : (
          <div className="field">
            <label htmlFor="pay-agent">Cash held by</label>
            <select
              id="pay-agent"
              value={collectedById}
              onChange={(e) => setCollectedById(e.target.value)}
              disabled={!canRecord}
            >
              {collectors.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.id === me?.id ? ' (you)' : ''}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="field">
          <label htmlFor="pay-at">Received at</label>
          <input
            id="pay-at"
            type="datetime-local"
            required
            value={receivedAt}
            max={nowLocal()}
            onChange={(e) => setReceivedAt(e.target.value)}
          />
        </div>
      </div>
      <div className="field">
        <label htmlFor="pay-note">Note (optional)</label>
        <input
          id="pay-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={300}
        />
      </div>
      <ErrorBox error={error} />
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button type="submit" className="primary" disabled={busy || !amount}>
          {busy ? 'Saving…' : `Record ${amount ? formatRupees(amount) : 'payment'}`}
        </button>
      </div>
    </form>
  );
}

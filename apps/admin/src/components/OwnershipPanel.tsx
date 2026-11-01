'use client';

import { useState } from 'react';
import { AGREEMENT_STATE_LABELS, formatRupees, hasPermission } from '@voltneo/shared';
import { useSession } from '@/lib/session';
import type { Ownership, StaffDirectoryRow } from '@/lib/types';
import { PaymentForm, localToIso, nowLocal, openBlob } from '@/components/AgreementBits';
import { ErrorBox, Modal, Money, formatDate, useLoad } from '@/components/ui';

const LANGS = [
  { code: 'BN', label: 'বাংলা' },
  { code: 'HI', label: 'हिंदी' },
  { code: 'EN', label: 'English' },
] as const;

/**
 * Finishing early (rule 13, clause E7) and ownership transfer (rule 14,
 * clause E9, Schedule 8) for one agreement.
 */
export function OwnershipPanel({
  agreementId,
  refreshKey,
  onChanged,
}: {
  agreementId: string;
  /** Changes when the agreement changes elsewhere on the page (a payment), to refetch. */
  refreshKey: string;
  onChanged: () => void;
}) {
  const { api, can, staff: me } = useSession();
  const {
    data: o,
    error,
    reload,
    setData,
  } = useLoad(
    () => api.get<Ownership>(`/v1/agreements/${agreementId}/ownership`),
    [api, agreementId, refreshKey],
  );
  const directory = useLoad(() => api.get<StaffDirectoryRow[]>('/v1/staff/directory'), [api]);
  const [dialog, setDialog] = useState<'none' | 'early' | 'transfer'>('none');
  const [actionError, setActionError] = useState<unknown>(null);
  const [message, setMessage] = useState<string | null>(null);

  if (!o) return <ErrorBox error={error} />;
  const canPay = can('payments.record') || can('payments.collect_cash');
  if (!o.earlyExit && !o.transferDue && !o.transfer) return null;
  const staff = directory.data ?? [];

  return (
    <div className="card">
      <h2>{o.transfer || o.transferDue ? 'Ownership transfer' : 'Finishing early'}</h2>
      {message && <div className="alert success">{message}</div>}
      {dialog === 'none' && <ErrorBox error={actionError} />}

      {o.earlyExit && (
        <>
          <p className="muted" style={{ marginTop: 0 }}>
            The driver can finish at any time by paying every unpaid instalment in full; the down
            payment is not deducted (clause E7, D40). Quote for {formatDate(o.earlyExit.quotedOn)}:
          </p>
          <div className="stats">
            <div className="stat">
              <span className="muted">
                {o.earlyExit.instalmentsLeft} instalment
                {o.earlyExit.instalmentsLeft === 1 ? '' : 's'} left
              </span>
              <span className="value">
                <Money paise={o.earlyExit.remainingInstalments} />
              </span>
            </div>
            <div className="stat">
              <span className="muted">Late fees owed</span>
              <span className="value">
                <Money paise={o.earlyExit.lateFeesDue} />
              </span>
            </div>
            <div className="stat">
              <span className="muted">To finish today</span>
              <span className="value">
                <Money paise={o.earlyExit.total} />
              </span>
            </div>
          </div>
          {canPay && (
            <div className="row" style={{ marginTop: 12 }}>
              <button
                onClick={() => {
                  setActionError(null);
                  setDialog('early');
                }}
              >
                Record early finish
              </button>
            </div>
          )}
        </>
      )}

      {o.transferDue && (
        <>
          <div className="alert info">
            Paid in full on {formatDate(o.paidInFullOn)}. The battery now belongs to the driver.
            Switch off the GPS module in the supplier portal, then record it here to issue the
            Ownership Transfer Certificate (Schedule 8). Volt Neo service ends (D32).
          </div>
          {o.blockers.map((b) => (
            <div key={b} className="alert warn">
              {b}
            </div>
          ))}
          {o.driverCredit > 0 && (
            <div className="alert warn">
              Volt Neo holds {formatRupees(o.driverCredit)} of the driver&apos;s money from an
              overpayment. Refunds arrive with the payment gateway (M5); note it for finance.
            </div>
          )}
          {can('transfers.record') && (
            <div className="row">
              <button
                className="primary"
                disabled={o.blockers.length > 0}
                onClick={() => {
                  setActionError(null);
                  setDialog('transfer');
                }}
              >
                Record GPS switched off and transfer
              </button>
            </div>
          )}
        </>
      )}

      {o.transfer && (
        <>
          <dl className="kv">
            <dt>Certificate</dt>
            <dd className="mono">{o.transfer.certificateNumber}</dd>
            <dt>Paid in full</dt>
            <dd>{formatDate(o.transfer.paidInFullOn)}</dd>
            <dt>GPS module off</dt>
            <dd>
              {formatDate(o.transfer.gpsOffAt, true)} by {o.transfer.gpsOffByName} · portal ref{' '}
              <span className="mono">{o.transfer.gpsPortalReference}</span>
            </dd>
            <dt>Transferred</dt>
            <dd>
              {formatDate(o.transfer.transferredAt, true)}, recorded by {o.transfer.recordedByName}
              {o.transfer.note && ` · ${o.transfer.note}`}
            </dd>
          </dl>
          <div className="doc-grid" style={{ marginTop: 12 }}>
            <span>Schedule 8: Certificate</span>
            {LANGS.map((l) => (
              <button
                key={l.code}
                onClick={() =>
                  void openBlob(() =>
                    api.blob(`/v1/agreements/${agreementId}/certificate?lang=${l.code}`),
                  ).catch(setActionError)
                }
              >
                {l.label}
              </button>
            ))}
          </div>
        </>
      )}

      <Modal
        open={dialog === 'early'}
        onClose={() => setDialog('none')}
        title="Record early finish"
        wide
      >
        {o.earlyExit && (
          <PaymentForm
            agreementId={agreementId}
            maxHint={o.earlyExit.total}
            staff={staff}
            fixed={{
              amount: o.earlyExit.total,
              path: `/v1/agreements/${agreementId}/early-exit`,
              extra: { quotedTotalPaise: o.earlyExit.total },
              action: `Record ${formatRupees(o.earlyExit.total)} and finish`,
              intro: (
                <p className="muted">
                  Take exactly {formatRupees(o.earlyExit.total)}: every unpaid instalment
                  {o.earlyExit.lateFeesDue > 0 && ' and the late fees owed'}. The agreement becomes
                  &ldquo;{AGREEMENT_STATE_LABELS[o.earlyExit.resultingState]}&rdquo; and ownership
                  transfer is due. If the figure changed since the quote, nothing is recorded.
                </p>
              ),
            }}
            onDone={() => {
              setDialog('none');
              setMessage('Paid in full. The driver has been sent an SMS receipt.');
              void reload();
              onChanged();
            }}
          />
        )}
      </Modal>
      <Modal
        open={dialog === 'transfer'}
        onClose={() => setDialog('none')}
        title="Record GPS switched off and transfer ownership"
      >
        <TransferForm
          o={o}
          staff={staff.filter((s) => hasPermission(s.role, 'transfers.record'))}
          meId={me?.id ?? ''}
          error={actionError}
          onSubmit={async (body) => {
            setActionError(null);
            try {
              setData(await api.post<Ownership>(`/v1/agreements/${agreementId}/transfer`, body));
              setDialog('none');
              setMessage(
                'Ownership transferred. The certificate is ready and the driver has been sent an SMS.',
              );
              onChanged();
            } catch (err) {
              setActionError(err);
            }
          }}
        />
      </Modal>
    </div>
  );
}

function TransferForm({
  o,
  staff,
  meId,
  error,
  onSubmit,
}: {
  o: Ownership;
  staff: StaffDirectoryRow[];
  meId: string;
  error: unknown;
  onSubmit: (body: Record<string, unknown>) => Promise<void>;
}) {
  const [at, setAt] = useState(nowLocal());
  const [ref, setRef] = useState('');
  const [by, setBy] = useState(staff.some((s) => s.id === meId) ? meId : '');
  const [note, setNote] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        await onSubmit({
          gpsOffAt: localToIso(at),
          gpsPortalReference: ref,
          gpsOffById: by,
          note: note || undefined,
        });
        setBusy(false);
      }}
    >
      <p className="muted">
        This is final: the agreement becomes &ldquo;Ownership transferred&rdquo;, the battery leaves
        Volt Neo&apos;s inventory and no more service tickets can be opened.
      </p>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="t-at">Switched off at</label>
          <input
            id="t-at"
            type="datetime-local"
            required
            max={nowLocal()}
            value={at}
            onChange={(e) => setAt(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="t-ref">Portal reference</label>
          <input
            id="t-ref"
            required
            minLength={3}
            value={ref}
            onChange={(e) => setRef(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="t-by">Done by</label>
          <select id="t-by" required value={by} onChange={(e) => setBy(e.target.value)}>
            <option value="">Choose</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.id === meId ? ' (you)' : ''}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="field">
        <label htmlFor="t-note">Note (optional)</label>
        <input id="t-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
      </div>
      <label className="check">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
        />
        <span>
          The GPS module of battery <span className="mono">{o.battery?.serial}</span>
          {o.battery?.gpsDeviceId && (
            <>
              {' '}
              (IMEI <span className="mono">{o.battery.gpsDeviceId}</span>)
            </>
          )}{' '}
          is switched off in the supplier portal
        </span>
      </label>
      <ErrorBox error={error} />
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button type="submit" className="primary" disabled={busy || !confirmed || !by}>
          {busy ? 'Saving…' : 'Transfer ownership and issue certificate'}
        </button>
      </div>
    </form>
  );
}

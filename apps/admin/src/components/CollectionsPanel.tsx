'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import {
  COLLECTION_STAGE_LABELS,
  ROLE_LABELS,
  formatRupees,
  hasPermission,
  type CollectionStage,
} from '@voltneo/shared';
import { useSession } from '@/lib/session';
import type { AgreementCollections, StaffDirectoryRow } from '@/lib/types';
import { localToIso, nowLocal, openLink } from '@/components/AgreementBits';
import { ErrorBox, Modal, Money, formatDate, useLoad } from '@/components/ui';

const STAGE_TONE: Record<CollectionStage, string> = {
  GRACE: 'warn',
  FINAL_NOTICE: 'warn',
  DUE_FOR_IMMOBILISATION: 'deactivated',
  IMMOBILISATION_REQUESTED: 'warn',
  AWAITING_DISABLE: 'deactivated',
  IMMOBILISED: 'deactivated',
  RESTORE_DUE: 'active',
  DUE_FOR_RECOVERY: 'deactivated',
  RECOVERY_REQUESTED: 'warn',
  AWAITING_COLLECTION: 'deactivated',
};

export function StageBadge({ stage }: { stage: CollectionStage | null }) {
  if (!stage) return <span className="badge active">Up to date</span>;
  return <span className={`badge ${STAGE_TONE[stage]}`}>{COLLECTION_STAGE_LABELS[stage]}</span>;
}

const NOTICE_LABELS: Record<string, string> = {
  REMINDER_5: 'Reminder, 5 days before',
  REMINDER_3: 'Reminder, 3 days before',
  REMINDER_1: 'Reminder, 1 day before',
  REMINDER_0: 'Reminder, due today',
  FINAL_NOTICE: 'Final notice',
  IMMOBILISED: 'Battery disabled',
  RESTORED: 'Battery switched back on',
};

type Dialog = 'none' | 'requestImm' | 'disable' | 'restore' | 'requestRec' | 'recovery';

/** Collections status and actions for one agreement (spec module 9). */
export function CollectionsPanel({
  agreementId,
  battery,
  onChanged,
}: {
  agreementId: string;
  battery: { id: string; serial: string } | null;
  onChanged: () => void;
}) {
  const { api, can, staff: me } = useSession();
  const {
    data: c,
    error,
    reload,
    setData,
  } = useLoad(
    () => api.get<AgreementCollections>(`/v1/agreements/${agreementId}/collections`),
    [api, agreementId],
  );
  const directory = useLoad(() => api.get<StaffDirectoryRow[]>('/v1/staff/directory'), [api]);
  const [dialog, setDialog] = useState<Dialog>('none');
  const [actionError, setActionError] = useState<unknown>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!c) return <ErrorBox error={error} />;
  const assign = can('collections.assign');
  const requestable = assign && can('approvals.request');
  const staff = directory.data ?? [];

  async function act(fn: () => Promise<unknown>, done: string) {
    setBusy(true);
    setActionError(null);
    setMessage(null);
    try {
      const res = await fn();
      if (res && typeof res === 'object' && 'allowed' in res) setData(res as AgreementCollections);
      else await reload();
      setDialog('none');
      setMessage(done);
      onChanged();
    } catch (err) {
      setActionError(err);
    } finally {
      setBusy(false);
    }
  }

  const open = (d: Dialog) => {
    setActionError(null);
    setDialog(d);
  };

  const showsOverdue = !!c.spellStartedOn || c.toClear > 0;

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>Collections</h2>
        <StageBadge stage={c.stage} />
      </div>
      {message && (
        <div className="alert success" style={{ marginTop: 10 }}>
          {message}
        </div>
      )}
      {dialog === 'none' && <ErrorBox error={actionError} />}

      {showsOverdue && (
        <div className="stats" style={{ margin: '12px 0' }}>
          <div className="stat">
            <span className="muted">Days overdue</span>
            <span className="value">{c.daysOverdue}</span>
          </div>
          <div className="stat">
            <span className="muted">Instalments overdue</span>
            <span className="value">
              <Money paise={c.overdueAmount} />
            </span>
          </div>
          <div className="stat">
            <span className="muted">Late fees due</span>
            <span className="value">
              <Money paise={c.lateFeesDue} />
            </span>
          </div>
          <div className="stat">
            <span className="muted">To clear</span>
            <span className="value">
              <Money paise={c.toClear} />
            </span>
          </div>
        </div>
      )}
      <dl className="kv">
        {c.spellStartedOn && (
          <>
            <dt>Late since</dt>
            <dd>
              Due date {formatDate(c.spellStartedOn)} missed. Late fee from{' '}
              {formatDate(c.lateFeeFrom)}: {c.lateFeeDaysInSpell} of {c.lateFeeCapDays} days charged
            </dd>
          </>
        )}
        {c.immobilisedAt && (
          <>
            <dt>Battery disabled</dt>
            <dd>
              {formatDate(c.immobilisedAt, true)}; recovery due from {formatDate(c.recoveryDueOn)}
            </dd>
          </>
        )}
        {c.restoreDueSince && (
          <>
            <dt>Restore due</dt>
            <dd>
              Paid {formatDate(c.restoreDueSince, true)}. Switch the battery back on in the GPS
              portal and record it.
            </dd>
          </>
        )}
        {c.immobilisationRequest && (
          <>
            <dt>Immobilisation</dt>
            <dd>
              {c.immobilisationRequest.status === 'PENDING' ? 'Awaiting approval' : 'Approved'},
              asked by {c.immobilisationRequest.requestedByName}.{' '}
              {c.immobilisationRequest.status === 'PENDING' && (
                <Link href="/approvals">Approvals</Link>
              )}
            </dd>
          </>
        )}
        {c.recoveryRequest && (
          <>
            <dt>Recovery</dt>
            <dd>
              {c.recoveryRequest.status === 'PENDING' ? 'Awaiting approval' : 'Approved'}, asked by{' '}
              {c.recoveryRequest.requestedByName}.{' '}
              {c.recoveryRequest.status === 'PENDING' && <Link href="/approvals">Approvals</Link>}
            </dd>
          </>
        )}
      </dl>

      <div className="row" style={{ marginTop: 12 }}>
        {c.allowed.requestImmobilisation && requestable && (
          <button className="danger" onClick={() => open('requestImm')}>
            Request immobilisation
          </button>
        )}
        {c.allowed.recordDisable && assign && (
          <button className="danger" onClick={() => open('disable')}>
            Record battery disabled
          </button>
        )}
        {c.allowed.recordRestore && assign && (
          <button
            className={c.restoreDueSince ? 'primary' : undefined}
            onClick={() => open('restore')}
          >
            Record battery switched back on
          </button>
        )}
        {c.allowed.requestRecovery && requestable && (
          <button className="danger" onClick={() => open('requestRec')}>
            Request recovery
          </button>
        )}
        {c.allowed.recordRecovery && can('recovery.record') && (
          <button className="danger" onClick={() => open('recovery')}>
            Record recovery
          </button>
        )}
      </div>

      {c.recovery && (
        <>
          <h2 style={{ marginTop: 18 }}>Recovery</h2>
          <dl className="kv">
            <dt>Collected</dt>
            <dd>
              {formatDate(c.recovery.recoveredAt, true)} by {c.recovery.recoveredByName} at{' '}
              {c.recovery.location}
            </dd>
            <dt>Condition</dt>
            <dd>{c.recovery.conditionNote}</dd>
            <dt>Written off</dt>
            <dd>
              <Money paise={c.recovery.writtenOffAmount} /> instalments and{' '}
              <Money paise={c.recovery.writtenOffLateFees} /> late fees (not pursued, D45)
            </dd>
            {c.recovery.photos.length > 0 && (
              <>
                <dt>Photos</dt>
                <dd>
                  {c.recovery.photos.map((p, i) => (
                    <span key={p.id}>
                      {i > 0 && ' · '}
                      <button
                        className="link"
                        onClick={() =>
                          void openLink(() =>
                            api.post<{ url: string }>(
                              `/v1/agreements/${agreementId}/recovery/photos/${p.id}/link`,
                            ),
                          ).catch(setActionError)
                        }
                      >
                        {p.fileName}
                      </button>
                    </span>
                  ))}
                </dd>
              </>
            )}
          </dl>
        </>
      )}

      {c.log.length > 0 && (
        <>
          <h2 style={{ marginTop: 18 }}>GPS portal log</h2>
          <ul className="timeline">
            {c.log.map((l) => (
              <li key={l.id}>
                <strong>{l.action === 'DISABLE' ? 'Disabled' : 'Switched back on'}</strong>{' '}
                <span className="mono muted">{l.portalReference}</span>
                <div className="muted" style={{ fontSize: 13 }}>
                  {formatDate(l.performedAt, true)} by {l.performedByName}
                  {l.recordedByName !== l.performedByName && `, recorded by ${l.recordedByName}`}
                  {l.action === 'DISABLE' && ' · vehicle stationary confirmed'}
                  {l.note && ` · ${l.note}`}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {c.notices.length > 0 && (
        <details style={{ marginTop: 14 }}>
          <summary>Messages sent to the driver ({c.notices.length})</summary>
          <ul className="timeline">
            {c.notices.map((n, i) => (
              <li key={i}>
                {NOTICE_LABELS[n.kind] ?? n.kind}
                <span className="muted" style={{ fontSize: 13 }}>
                  {' '}
                  · {formatDate(n.createdAt, true)}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <Modal
        open={dialog === 'requestImm'}
        onClose={() => setDialog('none')}
        title="Request immobilisation"
      >
        <ReasonForm
          intro={`A second operations manager or super admin must approve. Approval is possible from ${formatDate(c.lateFeeFrom)} (day 6). ${formatRupees(c.toClear)} is overdue.`}
          action="Send for approval"
          busy={busy}
          error={actionError}
          onSubmit={(reason) =>
            act(
              () => api.post(`/v1/agreements/${agreementId}/immobilisation-request`, { reason }),
              'Sent for approval.',
            )
          }
        />
      </Modal>
      <Modal
        open={dialog === 'requestRec'}
        onClose={() => setDialog('none')}
        title="Request recovery"
      >
        <ReasonForm
          intro="A second operations manager or super admin must approve. Recovery staff then collect the battery following the conduct code."
          action="Send for approval"
          busy={busy}
          error={actionError}
          onSubmit={(reason) =>
            act(
              () => api.post(`/v1/agreements/${agreementId}/recovery-request`, { reason }),
              'Sent for approval.',
            )
          }
        />
      </Modal>
      <Modal
        open={dialog === 'disable'}
        onClose={() => setDialog('none')}
        title="Record battery disabled"
      >
        <PortalForm
          kind="DISABLE"
          staff={staff}
          meId={me?.id ?? ''}
          busy={busy}
          error={actionError}
          stillDue={c.toClear}
          onSubmit={(body) =>
            act(
              () => api.post(`/v1/agreements/${agreementId}/immobilisation`, body),
              'Recorded. The driver has been sent an SMS.',
            )
          }
        />
      </Modal>
      <Modal
        open={dialog === 'restore'}
        onClose={() => setDialog('none')}
        title="Record battery switched back on"
      >
        <PortalForm
          kind="RESTORE"
          staff={staff}
          meId={me?.id ?? ''}
          busy={busy}
          error={actionError}
          stillDue={c.restoreDueSince ? 0 : c.toClear}
          onSubmit={(body) =>
            act(
              () => api.post(`/v1/agreements/${agreementId}/immobilisation`, body),
              'Recorded. The driver has been sent an SMS.',
            )
          }
        />
      </Modal>
      <Modal
        open={dialog === 'recovery'}
        onClose={() => setDialog('none')}
        title="Record recovery"
        wide
      >
        <RecoveryForm
          battery={battery}
          staff={staff}
          busy={busy}
          error={actionError}
          onSubmit={(form) =>
            act(
              () => api.upload(`/v1/agreements/${agreementId}/recovery`, form),
              'Recovered. The agreement is closed and unpaid dues are written off.',
            )
          }
        />
      </Modal>
    </div>
  );
}

function ReasonForm({
  intro,
  action,
  busy,
  error,
  onSubmit,
}: {
  intro: string;
  action: string;
  busy: boolean;
  error: unknown;
  onSubmit: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(reason);
      }}
    >
      <p className="muted">{intro}</p>
      <div className="field">
        <label htmlFor="c-reason">Reason</label>
        <input
          id="c-reason"
          required
          minLength={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>
      <ErrorBox error={error} />
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button type="submit" className="primary" disabled={busy}>
          {action}
        </button>
      </div>
    </form>
  );
}

function PortalForm({
  kind,
  staff,
  meId,
  busy,
  error,
  stillDue,
  onSubmit,
}: {
  kind: 'DISABLE' | 'RESTORE';
  staff: StaffDirectoryRow[];
  meId: string;
  busy: boolean;
  error: unknown;
  stillDue: number;
  onSubmit: (body: Record<string, unknown>) => void;
}) {
  const [performedAt, setPerformedAt] = useState(nowLocal());
  const [ref, setRef] = useState('');
  const [by, setBy] = useState(meId);
  const [stationary, setStationary] = useState(false);
  const [note, setNote] = useState('');
  const actors = staff.filter((s) => hasPermission(s.role, 'collections.assign'));
  const needsReason = kind === 'RESTORE' && stillDue > 0;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({
          action: kind,
          performedAt: localToIso(performedAt),
          portalReference: ref,
          performedById: by || undefined,
          vehicleStationaryConfirmed: kind === 'DISABLE' ? stationary : undefined,
          note: note || undefined,
        });
      }}
    >
      <p className="muted">
        {kind === 'DISABLE'
          ? 'Disable the battery in the GPS supplier portal only when the portal shows the vehicle stationary, then record it here.'
          : 'Switch the battery back on in the GPS supplier portal, then record it here. There is no reconnection fee.'}
      </p>
      {needsReason && (
        <div className="alert warn">
          {formatRupees(stillDue)} is still due. Switching back on without payment needs a reason
          (for example a medical emergency); the agreement stays overdue.
        </div>
      )}
      <div className="form-grid">
        <div className="field">
          <label htmlFor="p-at">Done at</label>
          <input
            id="p-at"
            type="datetime-local"
            required
            max={nowLocal()}
            value={performedAt}
            onChange={(e) => setPerformedAt(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="p-ref">Portal reference</label>
          <input
            id="p-ref"
            required
            minLength={3}
            value={ref}
            onChange={(e) => setRef(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="p-by">Done by</label>
          <select id="p-by" value={by} onChange={(e) => setBy(e.target.value)}>
            {actors.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.id === meId ? ' (you)' : ''}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="field">
        <label htmlFor="p-note">{needsReason ? 'Reason' : 'Note (optional)'}</label>
        <input
          id="p-note"
          required={needsReason}
          minLength={needsReason ? 3 : undefined}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
      {kind === 'DISABLE' && (
        <label className="check">
          <input
            type="checkbox"
            checked={stationary}
            onChange={(e) => setStationary(e.target.checked)}
          />
          The GPS portal showed the vehicle stationary when I disabled the battery
        </label>
      )}
      <ErrorBox error={error} />
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button
          type="submit"
          className={kind === 'DISABLE' ? 'danger' : 'primary'}
          disabled={busy || (kind === 'DISABLE' && !stationary)}
        >
          {kind === 'DISABLE' ? 'Record disabled' : 'Record switched back on'}
        </button>
      </div>
    </form>
  );
}

function RecoveryForm({
  battery,
  staff,
  busy,
  error,
  onSubmit,
}: {
  battery: { id: string; serial: string } | null;
  staff: StaffDirectoryRow[];
  busy: boolean;
  error: unknown;
  onSubmit: (form: FormData) => void;
}) {
  const photos = useRef<HTMLInputElement>(null);
  const [by, setBy] = useState('');
  const [at, setAt] = useState(nowLocal());
  const [location, setLocation] = useState('');
  const [condition, setCondition] = useState('');
  const [serialOk, setSerialOk] = useState(false);
  const collectors = staff.filter((s) => hasPermission(s.role, 'recovery.record'));
  if (!battery) return <p className="muted">This agreement has no battery.</p>;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData();
        form.set('batteryId', battery.id);
        form.set('recoveredById', by);
        form.set('recoveredAt', localToIso(at));
        form.set('location', location);
        form.set('conditionNote', condition);
        for (const f of Array.from(photos.current?.files ?? []).slice(0, 6))
          form.append('photos', f);
        onSubmit(form);
      }}
    >
      <p className="muted">
        The down payment and instalments already paid are kept; unpaid instalments and late fees are
        written off and the agreement is closed (D44, D45).
      </p>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="r-by">Collected by</label>
          <select id="r-by" required value={by} onChange={(e) => setBy(e.target.value)}>
            <option value="">Choose</option>
            {collectors.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} · {ROLE_LABELS[s.role]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="r-at">Collected at</label>
          <input
            id="r-at"
            type="datetime-local"
            required
            max={nowLocal()}
            value={at}
            onChange={(e) => setAt(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="r-loc">Place</label>
          <input
            id="r-loc"
            required
            minLength={3}
            value={location}
            onChange={(e) => setLocation(e.target.value)}
          />
        </div>
      </div>
      <div className="field">
        <label htmlFor="r-cond">Condition of battery and GPS module</label>
        <input
          id="r-cond"
          required
          minLength={3}
          value={condition}
          onChange={(e) => setCondition(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="r-photos">Photos (optional, up to 6)</label>
        <input id="r-photos" ref={photos} type="file" accept="image/*" multiple />
      </div>
      <label className="check">
        <input type="checkbox" checked={serialOk} onChange={(e) => setSerialOk(e.target.checked)} />
        The collected battery&apos;s serial number is <span className="mono">{battery.serial}</span>
      </label>
      <ErrorBox error={error} />
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button type="submit" className="danger" disabled={busy || !serialOk}>
          Record recovery and close the agreement
        </button>
      </div>
    </form>
  );
}

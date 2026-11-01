'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useRef, useState } from 'react';
import {
  TICKET_CATEGORY_LABELS,
  TICKET_CHANNEL_LABELS,
  TICKET_OUTCOMES,
  TICKET_OUTCOME_LABELS,
  type TicketOutcome,
} from '@voltneo/shared';
import { useSession } from '@/lib/session';
import type { BatteryRow, Paged, StaffDirectoryRow, TicketDetail } from '@/lib/types';
import { Forbidden } from '@/components/AppShell';
import { AgreementStateBadge, localToIso, nowLocal, openLink } from '@/components/AgreementBits';
import { DeadlineText, TicketStatusBadge, TimingBadge, technicians } from '@/components/TicketBits';
import { ErrorBox, Modal, formatDate, useLoad } from '@/components/ui';

type Dialog = 'none' | 'assign' | 'visit' | 'replace' | 'resolve' | 'cancel';

export default function TicketPage() {
  const { id } = useParams<{ id: string }>();
  const { api, can, staff: me } = useSession();
  const {
    data: t,
    error,
    setData,
  } = useLoad(() => api.get<TicketDetail>(`/v1/tickets/${id}`), [api, id]);
  const directory = useLoad(() => api.get<StaffDirectoryRow[]>('/v1/staff/directory'), [api]);
  const [dialog, setDialog] = useState<Dialog>('none');
  const [actionError, setActionError] = useState<unknown>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!can('tickets.read')) return <Forbidden />;
  if (!t) return <ErrorBox error={error} />;
  const techs = technicians(directory.data ?? []);

  async function act(fn: () => Promise<TicketDetail>, done: string) {
    setBusy(true);
    setActionError(null);
    setMessage(null);
    try {
      setData(await fn());
      setDialog('none');
      setMessage(done);
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

  return (
    <>
      <Link href="/tickets" className="back">
        ← Service tickets
      </Link>
      <div className="page-head">
        <div>
          <h1>
            <span className="mono">{t.number}</span> <TicketStatusBadge status={t.status} />{' '}
            <TimingBadge timing={t.timing} />
          </h1>
          <p className="muted">
            {TICKET_CATEGORY_LABELS[t.category]} · {t.driver.name} ·{' '}
            <a href={`tel:${t.driver.phone}`} className="mono">
              {t.driver.phone}
            </a>
          </p>
        </div>
        <div className="row">
          {t.allowed.visit && (
            <button className="primary" onClick={() => open('visit')}>
              Record visit
            </button>
          )}
          {t.allowed.replace && <button onClick={() => open('replace')}>Replace battery</button>}
          {t.allowed.resolve && (
            <button className="primary" onClick={() => open('resolve')}>
              Close ticket
            </button>
          )}
          {t.allowed.assign && (
            <button onClick={() => open('assign')}>
              {t.technicianId ? 'Reassign' : 'Assign technician'}
            </button>
          )}
          {t.allowed.cancel && (
            <button className="danger" onClick={() => open('cancel')}>
              Cancel
            </button>
          )}
        </div>
      </div>
      {message && <div className="alert success">{message}</div>}
      {dialog === 'none' && <ErrorBox error={actionError} />}
      {t.closeRequest && (
        <div className="card">
          <h2>Closed by {t.closeRequest.requestedByName ?? 'field staff'}: waiting for approval</h2>
          <dl className="kv">
            <dt>Outcome</dt>
            <dd>{TICKET_OUTCOME_LABELS[t.closeRequest.outcome]}</dd>
            <dt>What was done</dt>
            <dd>{t.closeRequest.resolution}</dd>
            <dt>Closed</dt>
            <dd>{formatDate(t.closeRequest.requestedAt, true)}</dd>
          </dl>
          {t.allowed.decideClose && (
            <div className="row" style={{ marginTop: 10 }}>
              <button
                className="primary"
                disabled={busy}
                onClick={() =>
                  void act(
                    () => api.post<TicketDetail>(`/v1/tickets/${t.id}/close/approve`),
                    'Closed. The driver has been sent an SMS.',
                  )
                }
              >
                Approve close
              </button>
              <button
                className="danger"
                disabled={busy}
                onClick={() => {
                  const reason = window.prompt(
                    'Why is it not closed yet? The field agent or technician sees this.',
                  );
                  if (!reason || reason.trim().length < 5) return;
                  void act(
                    () =>
                      api.post<TicketDetail>(`/v1/tickets/${t.id}/close/reject`, {
                        reason: reason.trim(),
                      }),
                    'Sent back. The ticket is open again.',
                  );
                }}
              >
                Send back
              </button>
            </div>
          )}
        </div>
      )}
      {t.closeRejected && (
        <div className="alert warn">
          Close sent back by {t.closeRejected.decidedByName ?? 'head office'} on{' '}
          {formatDate(t.closeRejected.decidedAt, true)}: {t.closeRejected.reason}
        </div>
      )}
      {t.status === 'ASSIGNED' && !t.allowed.visit && t.technicianId !== me?.id && (
        <div className="alert info">Assigned to {t.technicianName}.</div>
      )}

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
        <div className="card">
          <h2>Report</h2>
          <p style={{ whiteSpace: 'pre-wrap', marginTop: 0 }}>{t.description}</p>
          <dl className="kv">
            <dt>Reported</dt>
            <dd>
              {formatDate(t.reportedAt, true)} · {TICKET_CHANNEL_LABELS[t.channel]}
              {t.createdByName && `, logged by ${t.createdByName}`}
            </dd>
            <dt>Respond by</dt>
            <dd>
              {formatDate(t.dueBy, true)}
              {!t.respondedAt && (t.status === 'OPEN' || t.status === 'ASSIGNED') && (
                <>
                  {' · '}
                  <DeadlineText t={t} />
                </>
              )}
            </dd>
            <dt>First response</dt>
            <dd>{t.respondedAt ? formatDate(t.respondedAt, true) : 'Not yet'}</dd>
            <dt>Technician</dt>
            <dd>{t.technicianName ?? 'Not assigned'}</dd>
          </dl>
        </div>
        <div className="card">
          <h2>Agreement and battery</h2>
          <dl className="kv">
            <dt>Agreement</dt>
            <dd>
              <Link href={`/agreements/${t.agreement.id}`} className="mono">
                {t.agreement.number}
              </Link>{' '}
              <AgreementStateBadge state={t.agreement.state} />
            </dd>
            <dt>Battery reported</dt>
            <dd>
              <Link href={`/inventory/${t.batteryId}`} className="mono">
                {t.batterySerial}
              </Link>
            </dd>
            {t.agreementBatteryId && t.agreementBatteryId !== t.batteryId && (
              <>
                <dt>Battery now</dt>
                <dd>
                  <Link href={`/inventory/${t.agreementBatteryId}`} className="mono">
                    {t.replacements.at(-1)?.newBatterySerial ?? 'replacement fitted'}
                  </Link>
                </dd>
              </>
            )}
          </dl>
          {t.agreement.state === 'IMMOBILISED' && (
            <div className="alert warn" style={{ marginTop: 10 }}>
              The battery is disabled for unpaid dues. A replacement waits until it is switched back
              on.
            </div>
          )}
        </div>
      </div>

      {(t.status === 'RESOLVED' || t.status === 'CANCELLED') && (
        <div className="card">
          <h2>{t.status === 'RESOLVED' ? 'Resolution' : 'Cancelled'}</h2>
          {t.status === 'RESOLVED' ? (
            <dl className="kv">
              <dt>Outcome</dt>
              <dd>{t.outcome && TICKET_OUTCOME_LABELS[t.outcome]}</dd>
              <dt>What was done</dt>
              <dd>{t.resolution}</dd>
              <dt>Resolved</dt>
              <dd>
                {formatDate(t.resolvedAt, true)} by {t.resolvedByName}
                {t.closeApprovedByName && `, approved by ${t.closeApprovedByName}`}
              </dd>
            </dl>
          ) : (
            <p>
              {formatDate(t.cancelledAt, true)}: {t.cancelReason}
            </p>
          )}
        </div>
      )}

      {t.replacements.map((r) => (
        <div className="card" key={r.id}>
          <h2>Battery replaced</h2>
          <dl className="kv">
            <dt>Taken out</dt>
            <dd>
              <span className="mono">{r.oldBatterySerial}</span>: {r.oldBatteryNote}
            </dd>
            <dt>Fitted</dt>
            <dd>
              <span className="mono">{r.newBatterySerial}</span>, {r.voltageReading} V
            </dd>
            <dt>When</dt>
            <dd>
              {formatDate(r.replacedAt, true)} by {r.technicianName}
            </dd>
          </dl>
          <p className="muted" style={{ fontSize: 13 }}>
            Same agreement and payment schedule (clause C8). The old battery is under repair with
            the technician.
          </p>
        </div>
      ))}

      <div className="card">
        <h2>Visits</h2>
        {t.visits.length === 0 ? (
          <p className="muted">No visit recorded yet.</p>
        ) : (
          <ul className="timeline">
            {t.visits.map((v) => (
              <li key={v.id}>
                <strong>{formatDate(v.visitedAt, true)}</strong> · {v.technicianName}
                {v.voltageReading && ` · ${v.voltageReading} V`}
                <div>{v.finding}</div>
                {v.readingsNote && (
                  <div className="muted" style={{ fontSize: 13 }}>
                    Readings: {v.readingsNote}
                  </div>
                )}
                <div className="muted" style={{ fontSize: 13 }}>
                  Battery <span className="mono">{v.batterySerial}</span>
                  {v.recordedByName !== v.technicianName && ` · recorded by ${v.recordedByName}`}
                  {v.photos.map((p) => (
                    <span key={p.id}>
                      {' · '}
                      <button
                        className="link"
                        onClick={() =>
                          void openLink(() =>
                            api.post<{ url: string }>(`/v1/tickets/${t.id}/photos/${p.id}/link`),
                          ).catch(setActionError)
                        }
                      >
                        {p.fileName}
                      </button>
                    </span>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Modal open={dialog === 'assign'} onClose={() => setDialog('none')} title="Assign technician">
        <AssignForm
          current={t.technicianId}
          techs={techs}
          busy={busy}
          error={actionError}
          onSubmit={(technicianId) =>
            act(
              () => api.patch<TicketDetail>(`/v1/tickets/${t.id}`, { technicianId }),
              'Technician assigned.',
            )
          }
        />
      </Modal>
      <Modal open={dialog === 'visit'} onClose={() => setDialog('none')} title="Record visit" wide>
        <VisitForm
          t={t}
          techs={techs}
          busy={busy}
          error={actionError}
          onSubmit={(form) =>
            act(
              () => api.upload<TicketDetail>(`/v1/tickets/${t.id}/visits`, form),
              'Visit recorded.',
            )
          }
        />
      </Modal>
      <Modal
        open={dialog === 'replace'}
        onClose={() => setDialog('none')}
        title="Replace battery"
        wide
      >
        <ReplaceForm
          t={t}
          techs={techs}
          busy={busy}
          error={actionError}
          onSubmit={(form) =>
            act(
              () => api.upload<TicketDetail>(`/v1/tickets/${t.id}/replacement`, form),
              'Replacement recorded. The agreement now has the new battery.',
            )
          }
        />
      </Modal>
      <Modal open={dialog === 'resolve'} onClose={() => setDialog('none')} title="Close ticket">
        <ResolveForm
          replaced={t.replacements.length > 0}
          busy={busy}
          error={actionError}
          onSubmit={(body) =>
            act(
              () => api.post<TicketDetail>(`/v1/tickets/${t.id}/resolve`, body),
              t.allowed.resolveNeedsApproval
                ? 'Closed. Waiting for head office to approve.'
                : 'Closed. The driver has been sent an SMS.',
            )
          }
        />
      </Modal>
      <Modal open={dialog === 'cancel'} onClose={() => setDialog('none')} title="Cancel ticket">
        <CancelForm
          busy={busy}
          error={actionError}
          onSubmit={(reason) =>
            act(
              () => api.post<TicketDetail>(`/v1/tickets/${t.id}/cancel`, { reason }),
              'Ticket cancelled.',
            )
          }
        />
      </Modal>
    </>
  );
}

function Submit({ busy, label, danger }: { busy: boolean; label: string; danger?: boolean }) {
  return (
    <div className="row" style={{ justifyContent: 'flex-end' }}>
      <button type="submit" className={danger ? 'danger' : 'primary'} disabled={busy}>
        {busy ? 'Saving…' : label}
      </button>
    </div>
  );
}

function AssignForm({
  current,
  techs,
  busy,
  error,
  onSubmit,
}: {
  current: string | null;
  techs: StaffDirectoryRow[];
  busy: boolean;
  error: unknown;
  onSubmit: (id: string) => void;
}) {
  const [id, setId] = useState(current ?? '');
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(id);
      }}
    >
      <div className="field">
        <label htmlFor="a-tech">Technician</label>
        <select id="a-tech" required value={id} onChange={(e) => setId(e.target.value)}>
          <option value="">Choose</option>
          {techs.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
              {s.role !== 'TECHNICIAN' ? ' (manager)' : ''}
            </option>
          ))}
        </select>
      </div>
      <ErrorBox error={error} />
      <Submit busy={busy} label="Assign" />
    </form>
  );
}

function TechField({
  techs,
  value,
  onChange,
}: {
  techs: StaffDirectoryRow[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="field">
      <label htmlFor="v-tech">Technician</label>
      <select id="v-tech" value={value} onChange={(e) => onChange(e.target.value)}>
        {techs.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
    </div>
  );
}

function VisitForm({
  t,
  techs,
  busy,
  error,
  onSubmit,
}: {
  t: TicketDetail;
  techs: StaffDirectoryRow[];
  busy: boolean;
  error: unknown;
  onSubmit: (form: FormData) => void;
}) {
  const photos = useRef<HTMLInputElement>(null);
  const [at, setAt] = useState(nowLocal());
  const [tech, setTech] = useState(t.technicianId ?? '');
  const [voltage, setVoltage] = useState('');
  const [readings, setReadings] = useState('');
  const [finding, setFinding] = useState('');
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData();
        form.set('visitedAt', localToIso(at));
        if (tech) form.set('technicianId', tech);
        if (voltage) form.set('voltageReading', voltage);
        if (readings) form.set('readingsNote', readings);
        form.set('finding', finding);
        for (const f of Array.from(photos.current?.files ?? []).slice(0, 6))
          form.append('photos', f);
        onSubmit(form);
      }}
    >
      <p className="muted">
        A visit or phone call by the technician. The first one is the response the 48 hours measure.
        Readings build the battery&apos;s service history.
      </p>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="v-at">When</label>
          <input
            id="v-at"
            type="datetime-local"
            required
            max={nowLocal()}
            value={at}
            onChange={(e) => setAt(e.target.value)}
          />
        </div>
        <TechField techs={techs} value={tech} onChange={setTech} />
        <div className="field">
          <label htmlFor="v-volt">Voltage (V, optional)</label>
          <input
            id="v-volt"
            inputMode="decimal"
            value={voltage}
            onChange={(e) => setVoltage(e.target.value.replace(/[^\d.]/g, ''))}
          />
        </div>
      </div>
      <div className="field">
        <label htmlFor="v-read">Other readings (optional)</label>
        <input
          id="v-read"
          maxLength={500}
          value={readings}
          onChange={(e) => setReadings(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="v-find">What was found or done</label>
        <textarea
          id="v-find"
          required
          minLength={3}
          maxLength={1000}
          rows={3}
          value={finding}
          onChange={(e) => setFinding(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="v-photos">Photos (optional, up to 6)</label>
        <input id="v-photos" ref={photos} type="file" accept="image/*" multiple />
      </div>
      <ErrorBox error={error} />
      <Submit busy={busy} label="Record visit" />
    </form>
  );
}

function ReplaceForm({
  t,
  techs,
  busy,
  error,
  onSubmit,
}: {
  t: TicketDetail;
  techs: StaffDirectoryRow[];
  busy: boolean;
  error: unknown;
  onSubmit: (form: FormData) => void;
}) {
  const { api } = useSession();
  const stock = useLoad(
    () =>
      api.get<Paged<BatteryRow>>(
        `/v1/batteries?status=IN_STOCK&batteryTypeId=${t.agreement.batteryTypeId}&limit=200`,
      ),
    [api, t.agreement.batteryTypeId],
  );
  const photos = useRef<HTMLInputElement>(null);
  const [batteryId, setBatteryId] = useState('');
  const [at, setAt] = useState(nowLocal());
  const [tech, setTech] = useState(t.technicianId ?? '');
  const [voltage, setVoltage] = useState('');
  const [note, setNote] = useState('');
  const options = (stock.data?.items ?? []).filter((b) => b.gpsDeviceId);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData();
        form.set('newBatteryId', batteryId);
        form.set('replacedAt', localToIso(at));
        if (tech) form.set('technicianId', tech);
        form.set('voltageReading', voltage);
        form.set('oldBatteryNote', note);
        for (const f of Array.from(photos.current?.files ?? []).slice(0, 6))
          form.append('photos', f);
        onSubmit(form);
      }}
    >
      <p className="muted">
        Fit an in-stock battery of the same type with a GPS module. The agreement, plan and payment
        schedule stay the same (clause C8). Battery <span className="mono">{t.batterySerial}</span>{' '}
        goes under repair with the technician.
      </p>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="r-bat">New battery</label>
          <select
            id="r-bat"
            required
            value={batteryId}
            onChange={(e) => setBatteryId(e.target.value)}
          >
            <option value="">{stock.loading ? 'Loading…' : 'Choose'}</option>
            {options.map((b) => (
              <option key={b.id} value={b.id}>
                {b.serial}
                {b.location ? ` · ${b.location}` : ''}
              </option>
            ))}
          </select>
          {!stock.loading && options.length === 0 && (
            <p className="muted" style={{ margin: '6px 0 0' }}>
              No battery of this type with a GPS module is in stock.
            </p>
          )}
        </div>
        <div className="field">
          <label htmlFor="r-at">Fitted at</label>
          <input
            id="r-at"
            type="datetime-local"
            required
            max={nowLocal()}
            value={at}
            onChange={(e) => setAt(e.target.value)}
          />
        </div>
        <TechField techs={techs} value={tech} onChange={setTech} />
        <div className="field">
          <label htmlFor="r-volt">Voltage after fitting (V)</label>
          <input
            id="r-volt"
            required
            inputMode="decimal"
            value={voltage}
            onChange={(e) => setVoltage(e.target.value.replace(/[^\d.]/g, ''))}
          />
        </div>
      </div>
      <div className="field">
        <label htmlFor="r-note">Fault and condition of the battery taken out</label>
        <input
          id="r-note"
          required
          minLength={3}
          maxLength={1000}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="r-photos">Photos (optional, up to 6)</label>
        <input id="r-photos" ref={photos} type="file" accept="image/*" multiple />
      </div>
      <ErrorBox error={error} />
      <Submit busy={busy} label="Record replacement" />
    </form>
  );
}

function ResolveForm({
  replaced,
  busy,
  error,
  onSubmit,
}: {
  replaced: boolean;
  busy: boolean;
  error: unknown;
  onSubmit: (body: { outcome: TicketOutcome; resolution: string }) => void;
}) {
  const [outcome, setOutcome] = useState<TicketOutcome>(replaced ? 'REPLACED' : 'REPAIRED');
  const [resolution, setResolution] = useState('');
  const outcomes = TICKET_OUTCOMES.filter((o) => (replaced ? o === 'REPLACED' : o !== 'REPLACED'));
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ outcome, resolution });
      }}
    >
      <div className="field">
        <label htmlFor="s-out">Outcome</label>
        <select
          id="s-out"
          value={outcome}
          onChange={(e) => setOutcome(e.target.value as TicketOutcome)}
        >
          {outcomes.map((o) => (
            <option key={o} value={o}>
              {TICKET_OUTCOME_LABELS[o]}
            </option>
          ))}
        </select>
      </div>
      {outcome === 'NOT_COVERED' && (
        <div className="alert warn">
          Misuse, an accident or someone else&apos;s work (clause C7). Any charge needs an
          inspection report with photos first; charges are not handled in the system yet.
        </div>
      )}
      <div className="field">
        <label htmlFor="s-res">What was done</label>
        <textarea
          id="s-res"
          required
          minLength={3}
          maxLength={1000}
          rows={3}
          value={resolution}
          onChange={(e) => setResolution(e.target.value)}
        />
      </div>
      <ErrorBox error={error} />
      <Submit busy={busy} label="Resolve and tell the driver" />
    </form>
  );
}

function CancelForm({
  busy,
  error,
  onSubmit,
}: {
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
      <p className="muted">For a duplicate, or when the driver says the problem has gone.</p>
      <div className="field">
        <label htmlFor="x-reason">Reason</label>
        <input
          id="x-reason"
          required
          minLength={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>
      <ErrorBox error={error} />
      <Submit busy={busy} label="Cancel ticket" danger />
    </form>
  );
}

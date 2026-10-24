'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import {
  MANUAL_BATTERY_MOVES,
  RETIRABLE_STATUSES,
  type BatteryStatus,
  type StaffProfile,
} from '@voltneo/shared';
import { useSession } from '@/lib/session';
import type { BatteryRow, ServiceHistoryRow } from '@/lib/types';
import { ErrorBox, Modal, Money, StatusBadge, formatDate, useLoad } from '@/components/ui';

const EVENT_LABELS: Record<string, string> = {
  REGISTERED: 'Registered',
  MOVED: 'Moved',
  SENT_FOR_REPAIR: 'Sent for repair',
  RETURNED_TO_STOCK: 'Returned to stock',
  RETIRED: 'Retired',
  INSTALLED: 'Installed',
  RECOVERED: 'Recovered after default',
  REPLACED_OUT: 'Taken out (replaced)',
  INSTALLED_AS_REPLACEMENT: 'Fitted as a replacement',
  OWNERSHIP_TRANSFERRED: 'Ownership passed to the driver',
};

export default function BatteryPage() {
  const { id } = useParams<{ id: string }>();
  const { api, can } = useSession();
  const {
    data: b,
    error,
    setData,
  } = useLoad(() => api.get<BatteryRow>(`/v1/batteries/${id}`), [api, id]);
  const techs = useLoad(
    () =>
      can('staff.read')
        ? api.get<StaffProfile[]>('/v1/staff?role=TECHNICIAN&status=ACTIVE')
        : Promise.resolve([]),
    [api],
  );
  const history = useLoad(
    () => api.get<ServiceHistoryRow[]>(`/v1/batteries/${id}/service-history`),
    [api, id],
  );
  const [dialog, setDialog] = useState<'none' | 'move' | 'retire' | 'edit'>('none');
  const [to, setTo] = useState<BatteryStatus>('UNDER_REPAIR');
  const [location, setLocation] = useState('');
  const [technicianId, setTechnicianId] = useState('');
  const [note, setNote] = useState('');
  const [gps, setGps] = useState('');
  const [actionError, setActionError] = useState<unknown>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function act(fn: () => Promise<unknown>, done: string) {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
      setData(await api.get<BatteryRow>(`/v1/batteries/${id}`));
      setDialog('none');
      setMessage(done);
    } catch (err) {
      setActionError(err);
    } finally {
      setBusy(false);
    }
  }

  if (!b) return <ErrorBox error={error} />;
  const manage = can('batteries.manage');
  const moves = MANUAL_BATTERY_MOVES[b.status as BatteryStatus] ?? [];
  const retirable = RETIRABLE_STATUSES.includes(b.status as BatteryStatus) && !b.pendingRetirement;

  return (
    <>
      <Link href="/inventory" className="back">
        ← Inventory
      </Link>
      <div className="page-head">
        <div>
          <h1 className="mono" style={{ fontSize: 22 }}>
            {b.serial} <StatusBadge status={b.status} />
          </h1>
          <p className="muted">{b.batteryType.name}</p>
        </div>
        {manage && (
          <div className="row">
            {b.status !== 'RETIRED' && (
              <button
                onClick={() => {
                  setGps(b.gpsDeviceId ?? '');
                  setLocation(b.location ?? '');
                  setActionError(null);
                  setDialog('edit');
                }}
              >
                Edit
              </button>
            )}
            {moves.length > 0 && !b.pendingRetirement && (
              <button
                onClick={() => {
                  setTo(moves[0]!);
                  setLocation(b.location ?? '');
                  setTechnicianId('');
                  setNote('');
                  setActionError(null);
                  setDialog('move');
                }}
              >
                {moves[0] === 'UNDER_REPAIR' ? 'Send for repair' : 'Return to stock'}
              </button>
            )}
            {retirable && can('approvals.request') && (
              <button
                className="danger"
                onClick={() => {
                  setNote('');
                  setActionError(null);
                  setDialog('retire');
                }}
              >
                Retire…
              </button>
            )}
          </div>
        )}
      </div>
      {message && <div className="alert success">{message}</div>}
      {dialog === 'none' && <ErrorBox error={actionError} />}
      {b.pendingRetirement && (
        <div className="alert info">
          Waiting for a second person to approve retirement: “{b.pendingRetirement.reason}”. See{' '}
          <Link href="/approvals">Approvals</Link>.
        </div>
      )}

      <div className="card">
        <dl className="kv">
          <dt>GPS device</dt>
          <dd className="mono">{b.gpsDeviceId ?? 'Not fitted'}</dd>
          <dt>Location</dt>
          <dd>{b.location ?? '—'}</dd>
          <dt>Held by</dt>
          <dd>
            {b.holder.charAt(0) + b.holder.slice(1).toLowerCase()}
            {b.holder === 'TECHNICIAN' &&
              b.custody?.at(-1)?.toStaffName &&
              ` (${b.custody.at(-1)!.toStaffName})`}
          </dd>
          <dt>Purchased</dt>
          <dd>
            {formatDate(b.purchaseDate)}
            {b.purchaseCost !== undefined && (
              <>
                {' '}
                for <Money paise={b.purchaseCost} />
              </>
            )}
            {b.supplierRef && <span className="muted"> · {b.supplierRef}</span>}
          </dd>
          {b.notes && (
            <>
              <dt>Notes</dt>
              <dd>{b.notes}</dd>
            </>
          )}
        </dl>
      </div>

      <div className="section">
        <h2>Custody history</h2>
        <div className="card table-wrap" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>When (IST)</th>
                <th>What happened</th>
                <th>Status</th>
                <th>Where / with whom</th>
                <th>By</th>
              </tr>
            </thead>
            <tbody>
              {b.custody?.map((c) => (
                <tr key={c.id}>
                  <td>{formatDate(c.at, true)}</td>
                  <td>
                    {EVENT_LABELS[c.event] ?? c.event}
                    {c.note && <div className="muted">{c.note}</div>}
                  </td>
                  <td>
                    <StatusBadge status={c.toStatus} />
                  </td>
                  <td>{[c.toLocation, c.toStaffName].filter(Boolean).join(' · ') || '—'}</td>
                  <td>{c.byName}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {history.data && history.data.length > 0 && (
        <div className="section">
          <h2>Service history</h2>
          <div className="card table-wrap" style={{ padding: 0 }}>
            <table>
              <thead>
                <tr>
                  <th>When (IST)</th>
                  <th>Ticket</th>
                  <th>Finding</th>
                  <th className="num">Voltage</th>
                  <th>Technician</th>
                </tr>
              </thead>
              <tbody>
                {history.data.map((v) => (
                  <tr key={v.id}>
                    <td>{formatDate(v.visitedAt, true)}</td>
                    <td>
                      <Link href={`/tickets/${v.ticket.id}`} className="mono">
                        {v.ticket.number}
                      </Link>
                    </td>
                    <td>
                      {v.finding}
                      {v.readingsNote && <div className="muted">{v.readingsNote}</div>}
                    </td>
                    <td className="num">{v.voltageReading ? `${v.voltageReading} V` : '—'}</td>
                    <td>{v.technicianName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal
        open={dialog === 'move'}
        onClose={() => setDialog('none')}
        title={to === 'UNDER_REPAIR' ? 'Send for repair' : 'Return to stock'}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void act(
              () =>
                api.post(`/v1/batteries/${id}/status`, {
                  to,
                  location: location || null,
                  technicianId: technicianId || undefined,
                  note: note || null,
                }),
              to === 'UNDER_REPAIR' ? 'Sent for repair.' : 'Returned to stock.',
            );
          }}
        >
          <ErrorBox error={actionError} />
          {moves.length > 1 && (
            <div className="field">
              <label htmlFor="m-to">Move to</label>
              <select id="m-to" value={to} onChange={(e) => setTo(e.target.value as BatteryStatus)}>
                {moves.map((m) => (
                  <option key={m} value={m}>
                    {m === 'UNDER_REPAIR' ? 'Under repair' : 'In stock'}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="field">
            <label htmlFor="m-loc">Location</label>
            <input id="m-loc" value={location} onChange={(e) => setLocation(e.target.value)} />
          </div>
          {to === 'UNDER_REPAIR' && (
            <div className="field">
              <label htmlFor="m-tech">Technician (optional)</label>
              <select
                id="m-tech"
                value={technicianId}
                onChange={(e) => setTechnicianId(e.target.value)}
              >
                <option value="">At the location above</option>
                {techs.data?.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="field">
            <label htmlFor="m-note">Note</label>
            <input
              id="m-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Not holding charge"
            />
          </div>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button type="button" onClick={() => setDialog('none')}>
              Cancel
            </button>
            <button className="primary" type="submit" disabled={busy}>
              Save
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={dialog === 'retire'}
        onClose={() => setDialog('none')}
        title="Retire this battery"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void act(
              () => api.post(`/v1/batteries/${id}/retire`, { reason: note }),
              'Retirement requested. A second person must approve it.',
            );
          }}
        >
          <ErrorBox error={actionError} />
          <p>
            A retired battery leaves service for good. A second person (operations manager or super
            admin) must approve.
          </p>
          <div className="field">
            <label htmlFor="r-reason">Reason</label>
            <textarea
              id="r-reason"
              required
              minLength={5}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button type="button" onClick={() => setDialog('none')}>
              Cancel
            </button>
            <button className="primary" type="submit" disabled={busy || note.trim().length < 5}>
              Request approval
            </button>
          </div>
        </form>
      </Modal>

      <Modal open={dialog === 'edit'} onClose={() => setDialog('none')} title="Edit battery">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void act(
              () =>
                api.patch(`/v1/batteries/${id}`, {
                  gpsDeviceId: gps || null,
                  location: location || null,
                }),
              'Saved.',
            );
          }}
        >
          <ErrorBox error={actionError} />
          <div className="field">
            <label htmlFor="e-gps">GPS device ID</label>
            <input
              id="e-gps"
              className="mono"
              value={gps}
              onChange={(e) => setGps(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="e-loc">Location</label>
            <input id="e-loc" value={location} onChange={(e) => setLocation(e.target.value)} />
          </div>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button type="button" onClick={() => setDialog('none')}>
              Cancel
            </button>
            <button className="primary" type="submit" disabled={busy}>
              Save
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}

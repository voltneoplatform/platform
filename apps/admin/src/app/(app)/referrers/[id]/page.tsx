'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { REFERRER_KINDS, REFERRER_KIND_LABELS, type ReferrerKind } from '@voltneo/shared';
import { useSession } from '@/lib/session';
import type { ReferrerDetail } from '@/lib/types';
import { Forbidden } from '@/components/AppShell';
import { ErrorBox, Modal, formatDate, useLoad } from '@/components/ui';

/** An outside referrer (founder, 7 Nov 2026) and the drivers they referred. */
export default function ReferrerPage() {
  const { id } = useParams<{ id: string }>();
  const { api, can } = useSession();
  const r = useLoad(() => api.get<ReferrerDetail>(`/v1/referrers/${id}`), [api, id]);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [kind, setKind] = useState<ReferrerKind>('OTHER');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  if (!can('drivers.read')) return <Forbidden />;
  const d = r.data;
  if (!d) return <ErrorBox error={r.error} />;
  const manage = can('drivers.manage');

  async function save(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      r.setData(await api.patch<ReferrerDetail>(`/v1/referrers/${id}`, body));
      setEditing(false);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Link href="/referrals" className="back">
        ← Referrals
      </Link>
      <div className="page-head">
        <div>
          <h1>
            {d.name} {!d.active && <span className="badge">Inactive</span>}
          </h1>
          <p className="muted">
            <span className="mono">{d.code}</span> · <span className="mono">{d.phone}</span> ·{' '}
            {REFERRER_KIND_LABELS[d.kind as ReferrerKind]} · added {formatDate(d.createdAt)}
          </p>
        </div>
        {manage && (
          <div className="row">
            <button
              onClick={() => {
                setName(d.name);
                setPhone(d.phone);
                setKind(d.kind as ReferrerKind);
                setNotes(d.notes ?? '');
                setError(null);
                setEditing(true);
              }}
            >
              Edit
            </button>
            <button disabled={busy} onClick={() => void save({ active: !d.active })}>
              {d.active ? 'Mark inactive' : 'Mark active'}
            </button>
          </div>
        )}
      </div>
      {!editing && <ErrorBox error={error} />}
      {d.notes && <p>{d.notes}</p>}
      <div className="stats">
        <div className="stat">
          <span className="muted">Drivers referred</span>
          <span className="value">{d.referred}</span>
        </div>
        <div className="stat">
          <span className="muted">Approved</span>
          <span className="value">{d.approved}</span>
        </div>
        <div className="stat">
          <span className="muted">Battery installed</span>
          <span className="value">{d.installed}</span>
        </div>
      </div>
      <div className="card">
        <h2>Drivers referred</h2>
        <table>
          <thead>
            <tr>
              <th>Driver</th>
              <th>Mobile</th>
              <th>Registered</th>
              <th>Where they are</th>
            </tr>
          </thead>
          <tbody>
            {d.drivers.length === 0 && (
              <tr>
                <td colSpan={4} className="muted">
                  None yet.
                </td>
              </tr>
            )}
            {d.drivers.map((x) => (
              <tr key={x.id}>
                <td>
                  <Link href={`/drivers/${x.id}`}>{x.name}</Link>{' '}
                  <span className="mono muted">{x.code}</span>
                </td>
                <td className="mono">{x.phone}</td>
                <td>{formatDate(x.registeredAt)}</td>
                <td>
                  {x.installed
                    ? 'Battery installed'
                    : x.approval === 'APPROVED'
                      ? 'Approved'
                      : 'Registered'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Modal open={editing} onClose={() => setEditing(false)} title="Edit referrer">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save({ name, phone, kind, notes });
          }}
        >
          <ErrorBox error={error} />
          <div className="field">
            <label htmlFor="rf-name">Name</label>
            <input id="rf-name" required value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="rf-phone">Mobile number</label>
            <input
              id="rf-phone"
              className="mono"
              required
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="rf-kind">Who they are</label>
            <select
              id="rf-kind"
              value={kind}
              onChange={(e) => setKind(e.target.value as ReferrerKind)}
            >
              {REFERRER_KINDS.map((k) => (
                <option key={k} value={k}>
                  {REFERRER_KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="rf-notes">Notes</label>
            <input
              id="rf-notes"
              maxLength={300}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button type="submit" className="primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}

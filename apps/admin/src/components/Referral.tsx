'use client';

import Link from 'next/link';
import { useState } from 'react';
import { REFERRER_KINDS, REFERRER_KIND_LABELS, type ReferrerKind } from '@voltneo/shared';
import { useSession } from '@/lib/session';
import type { ReferredBy, ReferrerDetail } from '@/lib/types';
import { ErrorBox, useLoad } from '@/components/ui';

/** What a form sends for the referrer: an id, or null to clear. */
export function referralPayload(r: ReferredBy | null) {
  return { referredByReferrerId: r?.id ?? null };
}

export function ReferredByText({ r, link }: { r: ReferredBy | null; link?: boolean }) {
  if (!r) return <span className="muted">No one</span>;
  const name = link ? <Link href={`/referrers/${r.id}`}>{r.name}</Link> : r.name;
  return (
    <>
      {name} <span className="mono muted">{r.code}</span>
      <span className="muted"> · {REFERRER_KIND_LABELS[r.kind as ReferrerKind]}</span>
    </>
  );
}

/** Adds an outside referrer (head office only: referrals.manage). */
export function ReferrerForm({
  initial,
  onSaved,
  submitLabel,
}: {
  initial?: ReferrerDetail;
  onSaved: (r: ReferrerDetail) => void;
  submitLabel: string;
}) {
  const { api } = useSession();
  const [name, setName] = useState(initial?.name ?? '');
  const [phone, setPhone] = useState(initial?.phone ?? '');
  const [kind, setKind] = useState<ReferrerKind>((initial?.kind as ReferrerKind) ?? 'MECHANIC');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  return (
    <div>
      <ErrorBox error={error} />
      <div className="form-grid">
        <div className="field">
          <label htmlFor="ref-name">Name</label>
          <input id="ref-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="ref-phone">Mobile number</label>
          <input
            id="ref-phone"
            className="mono"
            inputMode="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="ref-kind">Who they are</label>
          <select
            id="ref-kind"
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
          <label htmlFor="ref-notes">Notes (optional)</label>
          <input
            id="ref-notes"
            maxLength={300}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
      </div>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button
          type="button"
          className="primary"
          disabled={busy || name.trim().length < 2 || phone.replace(/\D/g, '').length < 10}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              const body = { name, phone, kind, notes };
              onSaved(
                initial
                  ? await api.patch<ReferrerDetail>(`/v1/referrers/${initial.id}`, body)
                  : await api.post<ReferrerDetail>('/v1/referrers', body),
              );
            } catch (err) {
              setError(err);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? 'Saving…' : submitLabel}
        </button>
      </div>
    </div>
  );
}

/**
 * Referred by (founder, 7 Nov 2026): pick an outside referrer by name, mobile
 * or ID. Head office can also add a new referrer here.
 */
export function ReferralPicker({
  value,
  onChange,
}: {
  value: ReferredBy | null;
  onChange: (r: ReferredBy | null) => void;
}) {
  const { api, can } = useSession();
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);
  const results = useLoad(
    () =>
      search.trim().length >= 2
        ? api.get<{ items: ReferredBy[] }>(
            `/v1/referrals/search?search=${encodeURIComponent(search.trim())}`,
          )
        : Promise.resolve({ items: [] }),
    [api, search],
  );

  if (value) {
    return (
      <div className="row" style={{ alignItems: 'center', gap: 8 }}>
        <span>
          <ReferredByText r={value} />
        </span>
        <button type="button" className="link" onClick={() => onChange(null)}>
          Remove
        </button>
      </div>
    );
  }
  if (adding) {
    return (
      <div className="card">
        <h3 style={{ marginTop: 0 }}>New referrer</h3>
        <ReferrerForm
          submitLabel="Add referrer"
          onSaved={(r) => {
            onChange({ id: r.id, code: r.code, name: r.name, phone: r.phone, kind: r.kind });
            setAdding(false);
          }}
        />
        <button type="button" className="link" onClick={() => setAdding(false)}>
          Back
        </button>
      </div>
    );
  }
  const items = results.data?.items ?? [];
  return (
    <div>
      <input
        aria-label="Referred by"
        placeholder="Referrer's name, mobile or ID (REF-…)"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {search.trim().length >= 2 && (
        <ul className="timeline" style={{ marginTop: 6 }}>
          {items.map((o) => (
            <li key={o.id}>
              <button type="button" className="link" onClick={() => onChange(o)}>
                {o.name}
              </button>{' '}
              <span className="mono muted">{o.code}</span>{' '}
              <span className="muted" style={{ fontSize: 13 }}>
                {o.phone} · {REFERRER_KIND_LABELS[o.kind as ReferrerKind]}
              </span>
            </li>
          ))}
          {items.length === 0 && !results.loading && <li className="muted">No match.</li>}
        </ul>
      )}
      <ErrorBox error={results.error} />
      {can('referrals.manage') && (
        <button type="button" className="link" onClick={() => setAdding(true)}>
          + Add a new referrer
        </button>
      )}
    </div>
  );
}

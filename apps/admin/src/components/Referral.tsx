'use client';

import { useState } from 'react';
import { REFERRER_KINDS, REFERRER_KIND_LABELS, type ReferrerKind } from '@voltneo/shared';
import { useSession } from '@/lib/session';
import type { ReferralOption, ReferredBy, ReferrerDetail } from '@/lib/types';
import { ErrorBox, useLoad } from '@/components/ui';

/** What a form sends for the referral: one id, or both null to clear. */
export function referralPayload(r: ReferredBy | null) {
  return {
    referredByDriverId: r?.type === 'DRIVER' ? r.id : null,
    referredByReferrerId: r?.type === 'REFERRER' ? r.id : null,
  };
}

export function ReferredByText({ r }: { r: ReferredBy | null }) {
  if (!r) return <span className="muted">No one</span>;
  return (
    <>
      {r.name} <span className="mono muted">{r.code}</span>
      <span className="muted">
        {' '}
        · {r.type === 'DRIVER' ? 'Volt Neo driver' : REFERRER_KIND_LABELS[r.kind as ReferrerKind]}
      </span>
    </>
  );
}

/**
 * Referred by (founder, 7 Nov 2026): find a driver or an outside referrer by
 * name, phone or ID, or add a new outside referrer.
 */
export function ReferralPicker({
  value,
  onChange,
  excludeDriverId,
}: {
  value: ReferredBy | null;
  onChange: (r: ReferredBy | null) => void;
  excludeDriverId?: string;
}) {
  const { api, can } = useSession();
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [kind, setKind] = useState<ReferrerKind>('MECHANIC');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const results = useLoad(
    () =>
      search.trim().length >= 2
        ? api.get<{ items: ReferralOption[] }>(
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
        <h3 style={{ marginTop: 0 }}>New outside referrer</h3>
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
        </div>
        <div className="row">
          <button type="button" onClick={() => setAdding(false)}>
            Back
          </button>
          <button
            type="button"
            className="primary"
            disabled={busy || name.trim().length < 2 || phone.replace(/\D/g, '').length < 10}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                const r = await api.post<ReferrerDetail>('/v1/referrers', { name, phone, kind });
                onChange({
                  type: 'REFERRER',
                  id: r.id,
                  code: r.code,
                  name: r.name,
                  phone: r.phone,
                  kind: r.kind,
                });
                setAdding(false);
              } catch (err) {
                setError(err);
              } finally {
                setBusy(false);
              }
            }}
          >
            Add referrer
          </button>
        </div>
      </div>
    );
  }

  const items = (results.data?.items ?? []).filter(
    (o) => !(o.type === 'DRIVER' && o.id === excludeDriverId),
  );
  return (
    <div>
      <input
        aria-label="Referred by"
        placeholder="Name, mobile or ID (VND-… or REF-…)"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {search.trim().length >= 2 && (
        <ul className="timeline" style={{ marginTop: 6 }}>
          {items.map((o) => (
            <li key={`${o.type}-${o.id}`}>
              <button
                type="button"
                className="link"
                onClick={() =>
                  onChange({
                    type: o.type,
                    id: o.id,
                    code: o.code,
                    name: o.name,
                    phone: o.phone,
                    kind: o.type === 'REFERRER' ? o.detail : null,
                  })
                }
              >
                {o.name}
              </button>{' '}
              <span className="mono muted">{o.code}</span>{' '}
              <span className="muted" style={{ fontSize: 13 }}>
                {o.phone} ·{' '}
                {o.type === 'DRIVER'
                  ? `Driver, ${o.detail}`
                  : REFERRER_KIND_LABELS[o.detail as ReferrerKind]}
              </span>
            </li>
          ))}
          {items.length === 0 && !results.loading && <li className="muted">No match.</li>}
        </ul>
      )}
      <ErrorBox error={results.error} />
      {can('drivers.manage') && (
        <button type="button" className="link" onClick={() => setAdding(true)}>
          + Add an outside referrer (mechanic, shopkeeper…)
        </button>
      )}
    </div>
  );
}

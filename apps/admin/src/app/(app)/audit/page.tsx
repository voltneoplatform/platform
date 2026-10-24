'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ROLE_LABELS, type Role } from '@voltneo/shared';
import { useSession } from '@/lib/session';
import type { StaffDirectoryRow } from '@/lib/types';
import { Forbidden } from '@/components/AppShell';
import { useLoad } from '@/components/ui';

interface AuditRow {
  id: string;
  actorType: 'STAFF' | 'DRIVER' | 'SYSTEM';
  actorId: string | null;
  actorName: string | null;
  actorRole: Role | null;
  action: string;
  tableName: string;
  recordId: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
  requestId: string | null;
  at: string;
}

interface AuditPage {
  items: AuditRow[];
  nextBefore: string | null;
}

interface Facets {
  tables: { tableName: string; count: number }[];
  actions: { tableName: string; action: string; count: number }[];
}

/** Plain names for the record types in the log. */
const TABLE_LABELS: Record<string, string> = {
  staff_users: 'Staff',
  staff_sessions: 'Sign-ins',
  battery_types: 'Battery types',
  batteries: 'Batteries',
  plans: 'Plans',
  plan_versions: 'Plan versions',
  drivers: 'Drivers',
  kyc_documents: 'KYC documents',
  vehicles: 'Vehicles',
  agreements: 'Agreements',
  payments: 'Payments',
  cash_deposits: 'Cash deposits',
  approval_requests: 'Approvals',
  immobilisation_log: 'Disable and restore',
  recoveries: 'Recoveries',
  service_tickets: 'Service tickets',
  ownership_transfers: 'Ownership transfers',
};

/** Where a record can be opened, when it has its own page. */
function recordHref(r: AuditRow): string | null {
  if (!r.recordId) return null;
  const after = (r.after ?? {}) as Record<string, unknown>;
  switch (r.tableName) {
    case 'agreements':
      return `/agreements/${r.recordId}`;
    case 'drivers':
      return `/drivers/${r.recordId}`;
    case 'batteries':
      return `/inventory/${r.recordId}`;
    case 'battery_types':
      return `/battery-types/${r.recordId}`;
    case 'plans':
      return `/plans/${r.recordId}`;
    case 'service_tickets':
      return `/tickets/${r.recordId}`;
    case 'payments':
    case 'immobilisation_log':
    case 'recoveries':
    case 'ownership_transfers':
      return typeof after.agreementId === 'string' ? `/agreements/${after.agreementId}` : null;
    default:
      return null;
  }
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

const show = (v: unknown) =>
  v === null || v === undefined ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v);

/** The fields that changed, old value struck through, so a reader sees the change at a glance. */
function Changes({ before, after }: { before: unknown; after: unknown }) {
  if (!isObject(before) && !isObject(after)) {
    return <span className="muted">—</span>;
  }
  const b = isObject(before) ? before : {};
  const a = isObject(after) ? after : {};
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])].filter(
    (k) => !['updatedAt', 'createdAt'].includes(k) && JSON.stringify(b[k]) !== JSON.stringify(a[k]),
  );
  if (!keys.length) return <span className="muted">No field changed</span>;
  const shown = keys.slice(0, 12);
  return (
    <table className="diff">
      <tbody>
        {shown.map((k) => (
          <tr key={k}>
            <td>{k}</td>
            <td>
              {k in b && isObject(before) && <span className="old">{show(b[k])}</span>}
              {k in b && isObject(before) && k in a && ' → '}
              {k in a && show(a[k])}
            </td>
          </tr>
        ))}
        {keys.length > shown.length && (
          <tr>
            <td colSpan={2} className="muted">
              …and {keys.length - shown.length} more
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

export default function AuditLogPage() {
  const { api, can } = useSession();
  const [items, setItems] = useState<AuditRow[]>([]);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tableName, setTableName] = useState('');
  const [action, setAction] = useState('');
  const [actorId, setActorId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const allowed = can('audit.read');
  const facets = useLoad(
    () =>
      allowed
        ? api.get<Facets>('/v1/audit-log/facets')
        : Promise.resolve({ tables: [], actions: [] }),
    [api, allowed],
  );
  const directory = useLoad(() => api.get<StaffDirectoryRow[]>('/v1/staff/directory'), [api]);

  const load = useCallback(
    async (before?: string) => {
      if (!allowed) return;
      setLoading(true);
      const q = new URLSearchParams({ limit: '50' });
      if (tableName) q.set('tableName', tableName);
      if (action) q.set('action', action);
      if (actorId) q.set('actorId', actorId);
      if (from) q.set('from', from);
      if (to) q.set('to', to);
      if (before) q.set('before', before);
      try {
        const page = await api.get<AuditPage>(`/v1/audit-log?${q}`);
        setItems((prev) => (before ? [...prev, ...page.items] : page.items));
        setNextBefore(page.nextBefore);
        setError(null);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [api, allowed, tableName, action, actorId, from, to],
  );

  useEffect(() => {
    const t = setTimeout(() => void load(), 200);
    return () => clearTimeout(t);
  }, [load]);

  if (!can('audit.read')) return <Forbidden />;
  const actions = (facets.data?.actions ?? []).filter(
    (a) => !tableName || a.tableName === tableName,
  );

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Audit log</h1>
          <p className="muted">
            Who changed what and when, newest first. Entries are permanent: the database refuses
            edits and deletions.
          </p>
        </div>
      </div>
      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}
      <div className="filters">
        <select
          value={tableName}
          onChange={(e) => {
            setTableName(e.target.value);
            setAction('');
          }}
          aria-label="Record type"
        >
          <option value="">All record types</option>
          {(facets.data?.tables ?? []).map((t) => (
            <option key={t.tableName} value={t.tableName}>
              {TABLE_LABELS[t.tableName] ?? t.tableName} ({t.count})
            </option>
          ))}
        </select>
        <select value={action} onChange={(e) => setAction(e.target.value)} aria-label="Action">
          <option value="">All actions</option>
          {actions.map((a) => (
            <option key={`${a.tableName}:${a.action}`} value={a.action}>
              {a.action} ({a.count})
            </option>
          ))}
        </select>
        <select value={actorId} onChange={(e) => setActorId(e.target.value)} aria-label="By">
          <option value="">Anyone</option>
          {(directory.data ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <input
          type="date"
          value={from}
          max={to || undefined}
          onChange={(e) => setFrom(e.target.value)}
          aria-label="From date"
        />
        <input
          type="date"
          value={to}
          min={from || undefined}
          onChange={(e) => setTo(e.target.value)}
          aria-label="To date"
        />
      </div>
      <div className="card table-wrap" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>When (IST)</th>
              <th>Who</th>
              <th>Action</th>
              <th>Record</th>
              <th>What changed</th>
            </tr>
          </thead>
          <tbody>
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={5} className="empty">
                  No entries.
                </td>
              </tr>
            )}
            {items.map((r) => {
              const href = recordHref(r);
              return (
                <tr key={r.id}>
                  <td className="muted" style={{ whiteSpace: 'nowrap' }}>
                    {new Date(r.at).toLocaleString('en-IN', {
                      timeZone: 'Asia/Kolkata',
                      dateStyle: 'medium',
                      timeStyle: 'medium',
                    })}
                  </td>
                  <td>
                    {r.actorType === 'SYSTEM' ? (
                      'System (scheduled job)'
                    ) : r.actorName ? (
                      <>
                        <div>{r.actorName}</div>
                        {r.actorRole && (
                          <div className="muted" style={{ fontSize: 12 }}>
                            {ROLE_LABELS[r.actorRole]}
                          </div>
                        )}
                      </>
                    ) : (
                      <span className="muted">{r.actorType === 'DRIVER' ? 'Driver' : 'Staff'}</span>
                    )}
                  </td>
                  <td className="mono">{r.action}</td>
                  <td>
                    <div>{TABLE_LABELS[r.tableName] ?? r.tableName}</div>
                    {r.recordId &&
                      (href ? (
                        <Link href={href} className="mono">
                          {r.recordId.slice(0, 8)}
                        </Link>
                      ) : (
                        <div className="mono muted">{r.recordId.slice(0, 8)}</div>
                      ))}
                  </td>
                  <td style={{ minWidth: 220 }}>
                    <Changes before={r.before} after={r.after} />
                    {(r.before !== null || r.after !== null) && (
                      <details>
                        <summary className="muted" style={{ fontSize: 12 }}>
                          Full before and after
                        </summary>
                        <pre className="json">
                          {JSON.stringify({ before: r.before, after: r.after }, null, 1)}
                        </pre>
                      </details>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {nextBefore && (
        <div className="row" style={{ justifyContent: 'center', marginTop: 16 }}>
          <button disabled={loading} onClick={() => void load(nextBefore)}>
            {loading ? 'Loading…' : 'Load older entries'}
          </button>
        </div>
      )}
    </>
  );
}

'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSession } from '@/lib/session';
import { Forbidden } from '@/components/AppShell';

interface AuditRow {
  id: string;
  actorType: 'STAFF' | 'DRIVER' | 'SYSTEM';
  actorId: string | null;
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

export default function AuditPage() {
  const { api, can } = useSession();
  const [items, setItems] = useState<AuditRow[]>([]);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tableName, setTableName] = useState('');
  const [action, setAction] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (before?: string) => {
      setLoading(true);
      const q = new URLSearchParams({ limit: '50' });
      if (tableName) q.set('tableName', tableName);
      if (action.trim()) q.set('action', action.trim());
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
    [api, tableName, action],
  );

  useEffect(() => {
    const t = setTimeout(() => void load(), 200);
    return () => clearTimeout(t);
  }, [load]);

  if (!can('audit.read')) return <Forbidden />;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Audit log</h1>
          <p className="muted">
            Newest first. Entries are permanent: the database refuses edits and deletions.
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
          onChange={(e) => setTableName(e.target.value)}
          aria-label="Record type"
        >
          <option value="">All record types</option>
          <option value="staff_users">Staff</option>
          <option value="staff_sessions">Sign-ins</option>
        </select>
        <input
          placeholder="Exact action, e.g. staff.role_change"
          value={action}
          onChange={(e) => setAction(e.target.value)}
          aria-label="Action"
        />
      </div>
      <div className="card table-wrap" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>When (IST)</th>
              <th>Action</th>
              <th>By</th>
              <th>Record</th>
              <th>Before</th>
              <th>After</th>
            </tr>
          </thead>
          <tbody>
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={6} className="empty">
                  No entries.
                </td>
              </tr>
            )}
            {items.map((r) => (
              <tr key={r.id}>
                <td className="muted" style={{ whiteSpace: 'nowrap' }}>
                  {new Date(r.at).toLocaleString('en-IN', {
                    timeZone: 'Asia/Kolkata',
                    dateStyle: 'medium',
                    timeStyle: 'medium',
                  })}
                </td>
                <td className="mono">{r.action}</td>
                <td>
                  <div>
                    {r.actorType === 'STAFF'
                      ? 'Staff'
                      : r.actorType === 'SYSTEM'
                        ? 'System'
                        : 'Driver'}
                  </div>
                  {r.actorId && <div className="mono muted">{r.actorId.slice(0, 8)}</div>}
                </td>
                <td>
                  <div>{r.tableName}</div>
                  {r.recordId && <div className="mono muted">{r.recordId.slice(0, 8)}</div>}
                </td>
                <td>
                  {r.before ? (
                    <pre className="json">{JSON.stringify(r.before, null, 1)}</pre>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td>
                  {r.after ? (
                    <pre className="json">{JSON.stringify(r.after, null, 1)}</pre>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
              </tr>
            ))}
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

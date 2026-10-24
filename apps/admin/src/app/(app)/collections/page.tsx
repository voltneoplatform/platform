'use client';

import Link from 'next/link';
import { useState } from 'react';
import { COLLECTION_STAGES, COLLECTION_STAGE_LABELS, type CollectionStage } from '@voltneo/shared';
import { useSession } from '@/lib/session';
import type { CollectionsQueue } from '@/lib/types';
import { Forbidden } from '@/components/AppShell';
import { StageBadge } from '@/components/CollectionsPanel';
import { ErrorBox, Money, formatDate, useLoad } from '@/components/ui';

const JOB_LABELS: Record<string, string> = {
  'collections-daily': 'Daily check (00:05)',
  'collections-notices': 'Reminders and notices (09:00)',
};

export default function CollectionsPage() {
  const { api, can } = useSession();
  const [stage, setStage] = useState<CollectionStage | ''>('');
  const q = useLoad(
    () => api.get<CollectionsQueue>(`/v1/collections/queue${stage ? `?stage=${stage}` : ''}`),
    [api, stage],
  );
  const [error, setError] = useState<unknown>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  if (!can('collections.read')) return <Forbidden />;

  async function runNow() {
    setRunning(true);
    setError(null);
    setMessage(null);
    try {
      await api.post('/v1/collections/run', {});
      setMessage('Daily check and notices are up to date for today.');
      await q.reload();
    } catch (err) {
      setError(err);
    } finally {
      setRunning(false);
    }
  }

  const counts = q.data?.counts ?? {};
  const total = Object.values(counts).reduce((s, n) => s + (n ?? 0), 0);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Collections</h1>
          <p className="muted">
            Every driver who is overdue, disabled or due for recovery, longest overdue first.
            Immobilisation and recovery need a second person to approve.
          </p>
        </div>
        {can('collections.assign') && (
          <button onClick={() => void runNow()} disabled={running}>
            {running ? 'Running…' : 'Run daily check now'}
          </button>
        )}
      </div>
      {message && <div className="alert success">{message}</div>}
      <ErrorBox error={error ?? q.error} />

      <div className="filters">
        <select
          value={stage}
          onChange={(e) => setStage(e.target.value as CollectionStage | '')}
          aria-label="Stage"
        >
          <option value="">All stages{stage ? '' : ` (${total})`}</option>
          {COLLECTION_STAGES.map((s) => (
            <option key={s} value={s}>
              {COLLECTION_STAGE_LABELS[s]}
              {counts[s] ? ` (${counts[s]})` : ''}
            </option>
          ))}
        </select>
      </div>

      <div className="card table-wrap" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>Agreement</th>
              <th>Driver</th>
              <th className="num">Days</th>
              <th className="num">To clear</th>
              <th>Stage</th>
            </tr>
          </thead>
          <tbody>
            {q.data?.items.length === 0 && (
              <tr>
                <td colSpan={5} className="empty">
                  Nobody is overdue.
                </td>
              </tr>
            )}
            {q.data?.items.map((r) => (
              <tr key={r.agreementId}>
                <td>
                  <Link href={`/agreements/${r.agreementId}`} className="mono">
                    <strong>{r.number}</strong>
                  </Link>
                  <div className="muted" style={{ fontSize: 13 }}>
                    {r.vehicle}
                    {r.battery && <span className="mono"> · {r.battery.serial}</span>}
                  </div>
                </td>
                <td>
                  <Link href={`/drivers/${r.driver.id}`}>{r.driver.name}</Link>
                  <div className="muted" style={{ fontSize: 13 }}>
                    <a href={`tel:${r.driver.phone}`} className="mono">
                      {r.driver.phone}
                    </a>
                    {r.driver.area && ` · ${r.driver.area}`}
                  </div>
                </td>
                <td className="num">{r.daysOverdue || '—'}</td>
                <td className="num">
                  <Money paise={r.toClear} />
                  {r.lateFeesDue > 0 && (
                    <div className="muted" style={{ fontSize: 12 }}>
                      incl. <Money paise={r.lateFeesDue} /> fees
                    </div>
                  )}
                </td>
                <td>
                  <StageBadge stage={r.stage} />
                  {r.stage === 'IMMOBILISED' && r.recoveryDueOn && (
                    <div className="muted" style={{ fontSize: 12 }}>
                      recovery from {formatDate(r.recoveryDueOn)}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {q.data && (
        <p className="muted" style={{ fontSize: 13, marginTop: 14 }}>
          Today {formatDate(q.data.today)}. Last runs:{' '}
          {q.data.lastRuns.length === 0
            ? 'none yet'
            : q.data.lastRuns
                .slice(0, 2)
                .map(
                  (r) =>
                    `${JOB_LABELS[r.job] ?? r.job} for ${formatDate(r.date)} ${r.status === 'DONE' ? 'done' : r.status.toLowerCase()}`,
                )
                .join('; ')}
          .
        </p>
      )}
    </>
  );
}

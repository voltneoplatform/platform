'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  AGREEMENT_STATE_LABELS,
  BATTERY_STATUSES,
  BATTERY_STATUS_LABELS,
  COLLECTION_STAGES,
  COLLECTION_STAGE_LABELS,
  formatRupees,
  type AgreementState,
} from '@voltneo/shared';
import { useSession } from '@/lib/session';
import type { DashboardSummary } from '@/lib/types';
import { ErrorBox, formatDate, useLoad } from '@/components/ui';

const rs = (p: number) => formatRupees(p);
const METHOD_ROW = {
  CASH: 'In cash',
  UPI: 'By UPI',
  CARD: 'By card',
  ENACH: 'By e-NACH',
} as const;

function Received({ r, label }: { r: DashboardSummary['received']['day']; label: string }) {
  return (
    <div className="card">
      <div className="figure-sub">{label}</div>
      <div className="figure">{rs(r.total)}</div>
      <div className="figure-sub">
        {r.count} payment{r.count === 1 ? '' : 's'}
      </div>
      <dl className="kv-compact">
        <dt>Instalments</dt>
        <dd>{rs(r.instalments)}</dd>
        <dt>Down payments</dt>
        <dd>{rs(r.downPayments)}</dd>
        <dt>Late fees</dt>
        <dd>{rs(r.lateFees)}</dd>
        {r.driverCredit > 0 && (
          <>
            <dt>Overpaid (driver credit)</dt>
            <dd>{rs(r.driverCredit)}</dd>
          </>
        )}
        {(['CASH', 'UPI', 'CARD', 'ENACH'] as const)
          .filter((m) => r.byMethod[m])
          .map((m) => (
            <span key={m} style={{ display: 'contents' }}>
              <dt>{METHOD_ROW[m]}</dt>
              <dd>{rs(r.byMethod[m]!.amount)}</dd>
            </span>
          ))}
      </dl>
      <div
        className="figure-sub"
        style={{ marginTop: 8, color: r.matchesLedger ? undefined : 'var(--danger)' }}
      >
        {r.matchesLedger
          ? 'Matches the ledger'
          : `Does not match the ledger: payments ${rs(r.paymentsTotal)}. Tell finance.`}
      </div>
    </div>
  );
}

function Due({ d, label }: { d: DashboardSummary['due']['day']; label: string }) {
  return (
    <div className="card">
      <div className="figure-sub">{label}</div>
      <div className="figure">{rs(d.amount)}</div>
      <div className="figure-sub">
        {d.count} instalment{d.count === 1 ? '' : 's'}
      </div>
      <dl className="kv-compact">
        <dt>Paid so far</dt>
        <dd>{rs(d.paid)}</dd>
        <dt>Still unpaid</dt>
        <dd>{rs(d.unpaid)}</dd>
      </dl>
    </div>
  );
}

/** Management dashboard (spec module 11). */
export function Dashboard() {
  const { api, can } = useSession();
  const [date, setDate] = useState('');
  const { data: s, error } = useLoad(
    () => api.get<DashboardSummary>(`/v1/reports/summary${date ? `?date=${date}` : ''}`),
    [api, date],
  );
  if (!s) return <ErrorBox error={error} />;
  const isToday = s.date === s.today;
  const dayLabel = isToday ? 'today' : `on ${formatDate(s.date)}`;
  const monthName = new Date(`${s.month}-01T00:00:00+05:30`).toLocaleString('en-IN', {
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  });
  const stageRows = COLLECTION_STAGES.filter((st) => s.overdue.byStage[st]);
  const onTimeShare = s.tickets.respondedThisMonth
    ? Math.round((100 * s.tickets.respondedOnTimeThisMonth) / s.tickets.respondedThisMonth)
    : null;

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>Dashboard</h2>
        <label className="row" style={{ gap: 8, fontWeight: 400 }}>
          <span className="muted">Money for</span>
          <input
            type="date"
            max={s.today}
            value={date || s.today}
            onChange={(e) => setDate(e.target.value === s.today ? '' : e.target.value)}
            style={{ width: 'auto' }}
          />
        </label>
      </div>
      <ErrorBox error={error} />

      <div className="dash-grid">
        <div className="card">
          <div className="figure-sub">Active drivers</div>
          <div className="figure">{s.activeDrivers}</div>
          <dl className="kv-compact">
            {(['ACTIVE', 'IN_GRACE', 'IMMOBILISED'] as AgreementState[]).map((st) => (
              <span key={st} style={{ display: 'contents' }}>
                <dt>{AGREEMENT_STATE_LABELS[st]}</dt>
                <dd>{s.agreements.byState[st] ?? 0}</dd>
              </span>
            ))}
            <dt>Awaiting installation</dt>
            <dd>
              {(s.agreements.byState.AWAITING_INSTALLATION ?? 0) +
                (s.agreements.byState.AWAITING_DOWN_PAYMENT ?? 0)}
            </dd>
            <dt>Ownership transfer due</dt>
            <dd>{s.agreements.transferDue}</dd>
            <dt>Transferred in {monthName}</dt>
            <dd>{s.agreements.transferredThisMonth}</dd>
          </dl>
        </div>
        <Received r={s.received.day} label={`Received ${dayLabel}`} />
        <Received r={s.received.month} label={`Received in ${monthName}`} />
        <Due d={s.due.day} label={`Instalments due ${dayLabel}`} />
        <Due d={s.due.month} label={`Instalments due in ${monthName}`} />
        <div className="card">
          <div className="figure-sub">Overdue now</div>
          <div className="figure">{rs(s.overdue.instalments + s.overdue.lateFees)}</div>
          <div className="figure-sub">
            {s.overdue.drivers} driver{s.overdue.drivers === 1 ? '' : 's'}
          </div>
          <dl className="kv-compact">
            <dt>Instalments</dt>
            <dd>{rs(s.overdue.instalments)}</dd>
            <dt>Late fees</dt>
            <dd>{rs(s.overdue.lateFees)}</dd>
            {stageRows.map((st) => (
              <span key={st} style={{ display: 'contents' }}>
                <dt>{COLLECTION_STAGE_LABELS[st]}</dt>
                <dd>{s.overdue.byStage[st]}</dd>
              </span>
            ))}
          </dl>
          {can('collections.read') && (
            <div style={{ marginTop: 8 }}>
              <Link href="/collections">Collections queue</Link>
            </div>
          )}
        </div>
        <div className="card">
          <div className="figure-sub">Service tickets open</div>
          <div className="figure">{s.tickets.open + s.tickets.assigned}</div>
          <dl className="kv-compact">
            <dt>Waiting for a technician</dt>
            <dd>{s.tickets.open}</dd>
            <dt>Technician assigned</dt>
            <dd>{s.tickets.assigned}</dd>
            <dt>48 hours missed</dt>
            <dd style={s.tickets.missed ? { color: 'var(--danger)', fontWeight: 600 } : undefined}>
              {s.tickets.missed}
            </dd>
            <dt>Responded in time ({monthName})</dt>
            <dd>
              {onTimeShare === null ? '—' : `${onTimeShare}% of ${s.tickets.respondedThisMonth}`}
            </dd>
          </dl>
          {can('tickets.read') && (
            <div style={{ marginTop: 8 }}>
              <Link href="/tickets">Service tickets</Link>
            </div>
          )}
        </div>
        <div className="card">
          <div className="figure-sub">Batteries</div>
          <div className="figure">
            {Object.values(s.batteries).reduce((a, b) => (a ?? 0) + (b ?? 0), 0)}
          </div>
          <dl className="kv-compact">
            {BATTERY_STATUSES.filter((b) => s.batteries[b]).map((b) => (
              <span key={b} style={{ display: 'contents' }}>
                <dt>{BATTERY_STATUS_LABELS[b]}</dt>
                <dd>{s.batteries[b]}</dd>
              </span>
            ))}
          </dl>
        </div>
        <div className="card">
          <div className="figure-sub">Cash not yet in the bank</div>
          <div className="figure">{rs(s.cash.withAgents + s.cash.inTransit)}</div>
          <dl className="kv-compact">
            <dt>With agents</dt>
            <dd>{rs(s.cash.withAgents)}</dd>
            <dt>Deposited, not yet checked</dt>
            <dd>{rs(s.cash.inTransit)}</dd>
            <dt>Driver credit held</dt>
            <dd>{rs(s.cash.driverCredit)}</dd>
            <dt>Approvals waiting</dt>
            <dd>{s.pendingApprovals}</dd>
          </dl>
        </div>
      </div>
    </>
  );
}

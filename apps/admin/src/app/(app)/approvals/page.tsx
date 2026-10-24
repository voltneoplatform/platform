'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ROLE_LABELS, formatRupees, type Role } from '@voltneo/shared';
import { useSession } from '@/lib/session';
import type { ApprovalRow, FloorCheck } from '@/lib/types';
import { Forbidden } from '@/components/AppShell';
import { ErrorBox, Modal, StatusBadge, formatDate, useLoad } from '@/components/ui';

const TYPE_LABELS: Record<string, string> = {
  COST_FLOOR_EXCEPTION: 'Plan below cost floor',
  BATTERY_RETIRE: 'Retire battery',
  IMMOBILISE: 'Immobilise battery',
  RESTORE: 'Restore battery',
  RECOVER: 'Recover battery',
  VARIATION: 'Driver-specific variation',
  REFUND: 'Refund',
  WRITE_OFF: 'Write-off',
  PAYMENT_EDIT: 'Edit a payment',
};

function targetLink(r: ApprovalRow): string | null {
  if (r.targetTable === 'batteries') return `/inventory/${r.targetId}`;
  if (r.targetTable === 'agreements') return `/agreements/${r.targetId}`;
  const planId = (r.payload as { planId?: string } | null)?.planId;
  if (r.targetTable === 'plan_versions' && planId) return `/plans/${planId}`;
  return null;
}

function Detail({ r }: { r: ApprovalRow }) {
  if (r.type === 'COST_FLOOR_EXCEPTION') {
    const check = r.payload as FloorCheck | null;
    return (
      <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 13 }}>
        {check?.rows.map((x) => (
          <li key={x.batteryTypeId} className={x.passes ? '' : 'below'}>
            {x.batteryTypeName}: total {formatRupees(x.totalPayable)} vs floor{' '}
            {formatRupees(x.costFloor)}
            {!x.passes && ` (${formatRupees(-x.margin)} short)`}
          </li>
        ))}
        {targetLink(r) && (
          <li style={{ listStyle: 'none', marginLeft: -18 }}>
            <Link href={targetLink(r)!}>Open plan</Link>
          </li>
        )}
      </ul>
    );
  }
  const link = targetLink(r);
  return link ? (
    <div style={{ fontSize: 13 }}>
      <Link href={link}>Open</Link>
    </div>
  ) : null;
}

export default function ApprovalsPage() {
  const { api, can } = useSession();
  const [status, setStatus] = useState('PENDING');
  const { data, error, reload } = useLoad(
    () => api.get<ApprovalRow[]>(`/v1/approval-requests${status ? `?status=${status}` : ''}`),
    [api, status],
  );
  const [deciding, setDeciding] = useState<{
    row: ApprovalRow;
    outcome: 'approve' | 'reject';
  } | null>(null);
  const [note, setNote] = useState('');
  const [actionError, setActionError] = useState<unknown>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!can('approvals.request')) return <Forbidden />;

  async function decide(e: React.FormEvent) {
    e.preventDefault();
    if (!deciding) return;
    setBusy(true);
    setActionError(null);
    try {
      await api.post(`/v1/approval-requests/${deciding.row.id}/${deciding.outcome}`, {
        note: note || undefined,
      });
      const type = deciding.row.type;
      setMessage(
        deciding.outcome !== 'approve'
          ? 'Rejected.'
          : type === 'IMMOBILISE'
            ? 'Approved. Now disable the battery in the GPS portal and record it on the agreement.'
            : type === 'RECOVER'
              ? 'Approved. Recovery staff can now collect the battery and record it on the agreement.'
              : 'Approved. The action has been carried out.',
      );
      setDeciding(null);
      await reload();
    } catch (err) {
      setActionError(err);
    } finally {
      setBusy(false);
    }
  }

  async function cancel(r: ApprovalRow) {
    if (!window.confirm('Withdraw this request?')) return;
    try {
      await api.post(`/v1/approval-requests/${r.id}/cancel`);
      setMessage('Request withdrawn.');
      await reload();
    } catch (err) {
      setActionError(err);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Approvals</h1>
          <p className="muted">
            Sensitive actions need a second person. Nobody can approve their own request.
          </p>
        </div>
      </div>
      {message && <div className="alert success">{message}</div>}
      {!deciding && <ErrorBox error={actionError ?? error} />}
      <div className="filters">
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="PENDING">Waiting</option>
          <option value="APPROVED">Approved</option>
          <option value="REJECTED">Rejected</option>
          <option value="CANCELLED">Withdrawn</option>
          <option value="">All</option>
        </select>
      </div>
      <div className="card table-wrap" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>Request</th>
              <th>Reason</th>
              <th>Asked by</th>
              <th>Status</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {data?.length === 0 && (
              <tr>
                <td colSpan={5} className="empty">
                  Nothing here.
                </td>
              </tr>
            )}
            {data?.map((r) => (
              <tr key={r.id}>
                <td>
                  <div
                    className="muted"
                    style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.04em' }}
                  >
                    {TYPE_LABELS[r.type] ?? r.type}
                  </div>
                  <strong>{r.summary}</strong>
                  <Detail r={r} />
                </td>
                <td>{r.reason}</td>
                <td>
                  {r.requestedByName}
                  {r.isMine && <span className="muted"> (you)</span>}
                  <div className="muted" style={{ fontSize: 13 }}>
                    {formatDate(r.requestedAt, true)}
                  </div>
                </td>
                <td>
                  <StatusBadge status={r.status} />
                  {r.decidedByName && (
                    <div className="muted" style={{ fontSize: 13 }}>
                      {r.decidedByName}, {formatDate(r.decidedAt, true)}
                      {r.decisionNote && <div>“{r.decisionNote}”</div>}
                    </div>
                  )}
                </td>
                <td>
                  {r.status === 'PENDING' && (
                    <div className="row" style={{ justifyContent: 'flex-end' }}>
                      {r.canDecide ? (
                        <>
                          <button
                            className="primary"
                            onClick={() => {
                              setNote('');
                              setActionError(null);
                              setDeciding({ row: r, outcome: 'approve' });
                            }}
                          >
                            Approve
                          </button>
                          <button
                            className="danger"
                            onClick={() => {
                              setNote('');
                              setActionError(null);
                              setDeciding({ row: r, outcome: 'reject' });
                            }}
                          >
                            Reject
                          </button>
                        </>
                      ) : r.isMine ? (
                        <button onClick={() => void cancel(r)}>Withdraw</button>
                      ) : (
                        <span className="muted" style={{ fontSize: 13 }}>
                          Needs {r.approverRoles.map((x) => ROLE_LABELS[x as Role]).join(' or ')}
                        </span>
                      )}
                    </div>
                  )}
                  {r.status === 'PENDING' && r.isMine && (
                    <div className="muted" style={{ fontSize: 13, textAlign: 'right' }}>
                      A different person must decide
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal
        open={!!deciding}
        onClose={() => setDeciding(null)}
        title={deciding?.outcome === 'approve' ? 'Approve request' : 'Reject request'}
      >
        <form onSubmit={decide}>
          <ErrorBox error={actionError} />
          <p>
            <strong>{deciding?.row.summary}</strong>
          </p>
          <p className="muted">{deciding?.row.reason}</p>
          <div className="field">
            <label htmlFor="a-note">
              {deciding?.outcome === 'reject' ? 'Reason for rejecting' : 'Note (optional)'}
            </label>
            <textarea
              id="a-note"
              required={deciding?.outcome === 'reject'}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button type="button" onClick={() => setDeciding(null)}>
              Cancel
            </button>
            <button
              className="primary"
              type="submit"
              disabled={busy || (deciding?.outcome === 'reject' && note.trim().length < 3)}
            >
              {deciding?.outcome === 'approve' ? 'Approve' : 'Reject'}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}

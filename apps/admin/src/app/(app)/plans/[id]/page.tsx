'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { MAX_TERM_MONTHS, formatRupees, planNameProblems } from '@voltneo/shared';
import { ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import type { BatteryTypeRow, FloorCheck, PlanDetail, PlanVersionRow } from '@/lib/types';
import {
  ErrorBox,
  Modal,
  Money,
  RupeeInput,
  StatusBadge,
  formatDate,
  useLoad,
} from '@/components/ui';
import { NameFields } from '@/components/PlanNameFields';

type Row = { include: boolean; downPayment: number | null; instalment: number | null };

function PolicyTerms({ v }: { v: PlanVersionRow }) {
  return (
    <p className="muted" style={{ fontSize: 13 }}>
      Non-payment terms signed with this version: {v.graceDays}-day grace, then{' '}
      {formatRupees(v.lateFeePerDayPaise)} per day late fee for at most {v.lateFeeCapDays} days per
      late spell.
    </p>
  );
}

function PriceTable({ v, showCosts }: { v: PlanVersionRow; showCosts: boolean }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Battery type</th>
            <th className="right">Down payment</th>
            <th className="right">Monthly instalment</th>
            <th className="right">Total payable</th>
            {showCosts && <th className="right">Cost floor at publishing</th>}
          </tr>
        </thead>
        <tbody>
          {v.prices.map((p) => (
            <tr key={p.batteryTypeId}>
              <td>{p.batteryTypeName}</td>
              <td className="right">
                <Money paise={p.downPayment} />
              </td>
              <td className="right">
                <Money paise={p.instalment} />
              </td>
              <td className="right">
                <strong>
                  <Money paise={p.totalPayable} />
                </strong>
              </td>
              {showCosts && (
                <td
                  className={`right ${p.costFloor && p.totalPayable < p.costFloor ? 'below' : ''}`}
                >
                  <Money paise={p.costFloor} />
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function PlanPage() {
  const { id } = useParams<{ id: string }>();
  const { api, can } = useSession();
  const {
    data: plan,
    error,
    setData,
  } = useLoad(() => api.get<PlanDetail>(`/v1/plans/${id}`), [api, id]);
  const types = useLoad(() => api.get<BatteryTypeRow[]>('/v1/battery-types'), [api]);
  const manage = can('plans.manage');
  const showCosts = can('costs.read');

  const draft = plan?.versions.find((v) => v.status === 'DRAFT');
  const pending = plan?.versions.find((v) => v.status === 'PENDING_APPROVAL');
  const live = plan?.versions.find((v) => v.status === 'PUBLISHED');
  const history = plan?.versions.filter((v) => v.status === 'SUPERSEDED') ?? [];

  const [term, setTerm] = useState('');
  const [notes, setNotes] = useState('');
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<unknown>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [failedCheck, setFailedCheck] = useState<FloorCheck | null>(null);
  const [reason, setReason] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [names, setNames] = useState({ bn: '', hi: '', en: '' });

  // Load the draft into the editor whenever a different draft appears.
  useEffect(() => {
    if (!draft || !types.data) return;
    setTerm(draft.termMonths ? String(draft.termMonths) : '');
    setNotes(draft.notes ?? '');
    const r: Record<string, Row> = {};
    for (const t of types.data) {
      const p = draft.prices.find((x) => x.batteryTypeId === t.id);
      r[t.id] = {
        include: !!p,
        downPayment: p?.downPayment ?? null,
        instalment: p?.instalment ?? null,
      };
    }
    setRows(r);
    setDirty(false);
    setFailedCheck(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft?.id, draft?.updatedAt, types.data]);

  async function act<T>(fn: () => Promise<T>, done?: (r: T) => string | null) {
    setBusy(true);
    setActionError(null);
    setMessage(null);
    try {
      const res = await fn();
      const msg = done?.(res) ?? null;
      setMessage(msg);
      return res;
    } catch (err) {
      setActionError(err);
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  const termN = Number(term);
  const termOk = Number.isInteger(termN) && termN >= 1 && termN <= MAX_TERM_MONTHS;
  const included = Object.entries(rows).filter(([, r]) => r.include);
  const gridOk =
    included.length > 0 &&
    included.every(([, r]) => r.downPayment !== null && r.instalment !== null && r.instalment > 0);

  const draftBody = () => ({
    termMonths: termOk ? termN : undefined,
    notes: notes || null,
    prices: included.map(([batteryTypeId, r]) => ({
      batteryTypeId,
      downPayment: r.downPayment ?? 0,
      instalment: r.instalment ?? 0,
    })),
  });

  async function saveDraft() {
    const p = await act(
      () => api.patch<PlanDetail>(`/v1/plan-versions/${draft!.id}`, draftBody()),
      () => 'Draft saved.',
    );
    if (p) setData(p);
    return p;
  }

  async function publish(exceptionReason?: string) {
    if (dirty && !(await saveDraft())) return;
    setBusy(true);
    setActionError(null);
    setMessage(null);
    try {
      const res = await api.post<{ outcome: string; plan: PlanDetail }>(
        `/v1/plan-versions/${draft!.id}/publish`,
        {
          exceptionReason,
        },
      );
      setData(res.plan);
      setFailedCheck(null);
      setReason('');
      setMessage(
        res.outcome === 'PUBLISHED'
          ? `Version ${draft!.version} is live for new sign-ups.`
          : 'Sent for approval. It goes live when a second head-office person approves the exception.',
      );
    } catch (err) {
      const body =
        err instanceof ApiError ? (err.body as { code?: string; check?: FloorCheck }) : undefined;
      if (body?.code === 'BELOW_COST_FLOOR' && body.check) setFailedCheck(body.check);
      else setActionError(err);
    } finally {
      setBusy(false);
    }
  }

  if (!plan) return <ErrorBox error={error} />;

  return (
    <>
      <Link href="/plans" className="back">
        ← Plans
      </Link>
      <div className="page-head">
        <div>
          <h1>
            {plan.names.en} <StatusBadge status={plan.status} />
          </h1>
          <p className="muted">
            <span className="mono">{plan.code}</span> · {plan.names.bn} · {plan.names.hi}
          </p>
        </div>
        {manage && (
          <div className="row">
            <button
              onClick={() => {
                setNames(plan.names);
                setActionError(null);
                setRenaming(true);
              }}
            >
              Rename
            </button>
            {!draft && !pending && (
              <button
                onClick={() =>
                  void act(
                    () =>
                      api.post<PlanDetail>(`/v1/plans/${id}/versions`).then((p) => (setData(p), p)),
                    () => 'New draft started from the latest terms.',
                  )
                }
                disabled={busy}
              >
                Change terms (new version)
              </button>
            )}
            {plan.status !== 'DRAFT' && (
              <button
                className={plan.status === 'ACTIVE' ? 'danger' : undefined}
                disabled={busy}
                onClick={() => {
                  if (
                    plan.status === 'ACTIVE' &&
                    !window.confirm(
                      'Retire this plan? New drivers can no longer sign up to it. Existing agreements are not affected.',
                    )
                  )
                    return;
                  void act(
                    () =>
                      api
                        .patch<PlanDetail>(`/v1/plans/${id}`, {
                          status: plan.status === 'ACTIVE' ? 'RETIRED' : 'ACTIVE',
                        })
                        .then((p) => (setData(p), p)),
                    () => (plan.status === 'ACTIVE' ? 'Plan retired.' : 'Plan active again.'),
                  );
                }}
              >
                {plan.status === 'ACTIVE' ? 'Retire plan' : 'Make active'}
              </button>
            )}
          </div>
        )}
      </div>
      {message && <div className="alert success">{message}</div>}
      {!renaming && <ErrorBox error={actionError} />}

      {pending && (
        <div className="alert info">
          Version {pending.version} is waiting for a second person to approve publishing below the
          cost floor. <Link href="/approvals">Open approvals</Link>
        </div>
      )}

      {draft && manage && (
        <div className="card section">
          <h2>
            Version {draft.version} — draft
            {plan.versions.length > 1 && (
              <button
                className="link"
                disabled={busy}
                onClick={() =>
                  void act(
                    () =>
                      api
                        .post<PlanDetail>(`/v1/plan-versions/${draft.id}/discard`)
                        .then((p) => (setData(p), p)),
                    () => 'Draft discarded.',
                  )
                }
              >
                Discard draft
              </button>
            )}
          </h2>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="v-term">Number of monthly instalments</label>
              <input
                id="v-term"
                inputMode="numeric"
                value={term}
                onChange={(e) => {
                  setTerm(e.target.value.replace(/\D/g, ''));
                  setDirty(true);
                }}
              />
            </div>
            <div className="field">
              <label htmlFor="v-notes">Internal note</label>
              <input
                id="v-notes"
                value={notes}
                onChange={(e) => {
                  setNotes(e.target.value);
                  setDirty(true);
                }}
              />
            </div>
          </div>
          <PolicyTerms v={draft} />
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Offer with</th>
                  <th>Down payment</th>
                  <th>Monthly instalment</th>
                  <th className="right">Total payable</th>
                  {showCosts && <th className="right">Cost floor</th>}
                  {showCosts && <th className="right">Margin</th>}
                </tr>
              </thead>
              <tbody>
                {types.data
                  ?.filter((t) => t.status === 'ACTIVE' || rows[t.id]?.include)
                  .map((t) => {
                    const r = rows[t.id] ?? { include: false, downPayment: null, instalment: null };
                    const total =
                      r.include && termOk && r.instalment !== null
                        ? (r.downPayment ?? 0) + r.instalment * termN
                        : null;
                    const floor = t.currentCost?.costFloor;
                    const margin = total !== null && floor !== undefined ? total - floor : null;
                    const set = (patch: Partial<Row>) => {
                      setRows({ ...rows, [t.id]: { ...r, ...patch } });
                      setDirty(true);
                    };
                    return (
                      <tr key={t.id}>
                        <td>
                          <label className="checkbox">
                            <input
                              type="checkbox"
                              checked={r.include}
                              onChange={(e) => set({ include: e.target.checked })}
                            />
                            {t.name}
                          </label>
                          {t.status !== 'ACTIVE' && (
                            <div className="below">Archived: remove before publishing</div>
                          )}
                        </td>
                        <td>
                          {r.include && (
                            <RupeeInput
                              value={r.downPayment}
                              onChange={(v) => set({ downPayment: v })}
                            />
                          )}
                        </td>
                        <td>
                          {r.include && (
                            <RupeeInput
                              value={r.instalment}
                              allowZero={false}
                              onChange={(v) => set({ instalment: v })}
                            />
                          )}
                        </td>
                        <td className="right">
                          <strong>
                            <Money paise={total} />
                          </strong>
                        </td>
                        {showCosts && (
                          <td className="right">
                            <Money paise={r.include ? floor : null} />
                          </td>
                        )}
                        {showCosts && (
                          <td
                            className={`right num ${margin === null ? '' : margin < 0 ? 'below' : 'above'}`}
                          >
                            {margin === null
                              ? '—'
                              : `${margin < 0 ? '−' : '+'}${formatRupees(Math.abs(margin))}`}
                          </td>
                        )}
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>

          {failedCheck && (
            <div className="alert error" style={{ marginTop: 16 }}>
              <strong>Below the cost floor.</strong>{' '}
              {failedCheck.rows
                .filter((r) => !r.passes)
                .map((r) => `${r.batteryTypeName} is ${formatRupees(-r.margin)} short`)
                .join('; ')}
              . Raise the prices or term, or ask a second head-office person to approve an
              exception.
              <div className="field" style={{ marginTop: 12 }}>
                <label htmlFor="v-reason">Reason for the exception</label>
                <textarea
                  id="v-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. Pilot launch offer for the first 50 drivers"
                />
              </div>
              <button
                className="primary"
                disabled={busy || reason.trim().length < 5}
                onClick={() => void publish(reason.trim())}
              >
                Request exception approval
              </button>
            </div>
          )}

          <div className="row" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
            <button disabled={busy || !dirty || !termOk} onClick={() => void saveDraft()}>
              Save draft
            </button>
            <button
              className="primary"
              disabled={busy || !termOk || !gridOk || planNameProblems(plan.names).length > 0}
              onClick={() => void publish()}
            >
              {dirty ? 'Save and publish' : 'Publish'}
            </button>
          </div>
        </div>
      )}

      {live && (
        <div className="card section">
          <h2>
            Live: version {live.version}
            <span className="muted" style={{ fontSize: 13, fontWeight: 400 }}>
              Published {formatDate(live.publishedAt, true)}
            </span>
          </h2>
          {live.names && (
            <p className="muted" style={{ fontSize: 13 }}>
              Drivers on this version see the name “{live.names.en}” ({live.names.bn} ·{' '}
              {live.names.hi}), even if the plan is renamed later.
            </p>
          )}
          <p>
            <strong>{live.termMonths}</strong> monthly instalments
            {live.costFloorException && (
              <span className="badge warn" style={{ marginLeft: 8 }}>
                Published below cost floor by approved exception
              </span>
            )}
          </p>
          <PriceTable v={live} showCosts={showCosts} />
          <PolicyTerms v={live} />
        </div>
      )}

      {pending && (
        <div className="card section">
          <h2>Version {pending.version} — awaiting approval</h2>
          <p>
            <strong>{pending.termMonths}</strong> monthly instalments
          </p>
          <PriceTable v={pending} showCosts={showCosts} />
        </div>
      )}

      {history.length > 0 && (
        <div className="section">
          <h2>Earlier versions</h2>
          <p className="muted">Drivers who signed these keep their terms.</p>
          {history.map((v) => (
            <details key={v.id} className="card" style={{ marginBottom: 10 }}>
              <summary>
                Version {v.version} · {v.termMonths} instalments · published{' '}
                {formatDate(v.publishedAt)}
              </summary>
              <div style={{ marginTop: 12 }}>
                <PriceTable v={v} showCosts={showCosts} />
              </div>
            </details>
          ))}
        </div>
      )}

      <Modal open={renaming} onClose={() => setRenaming(false)} title="Rename plan">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void act(
              () =>
                api.patch<PlanDetail>(`/v1/plans/${id}`, {
                  nameBn: names.bn,
                  nameHi: names.hi,
                  nameEn: names.en,
                }),
              () => 'Renamed. New sign-ups see the new name.',
            ).then((p) => {
              if (p) {
                setData(p);
                setRenaming(false);
              }
            });
          }}
        >
          <ErrorBox error={actionError} />
          <p className="muted">
            The code {plan.code} never changes. Drivers who already signed keep the name they
            signed.
          </p>
          <NameFields value={names} onChange={setNames} />
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button type="button" onClick={() => setRenaming(false)}>
              Cancel
            </button>
            <button
              className="primary"
              type="submit"
              disabled={busy || planNameProblems(names).length > 0}
            >
              Save names
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}

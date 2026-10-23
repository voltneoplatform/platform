'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { planNameProblems } from '@voltneo/shared';
import { NameFields } from '@/components/PlanNameFields';
import { useSession } from '@/lib/session';
import type { PlanDetail, PlanListRow } from '@/lib/types';
import { Forbidden } from '@/components/AppShell';
import { ErrorBox, Modal, Money, StatusBadge, useLoad } from '@/components/ui';

export default function PlansPage() {
  const { api, can } = useSession();
  const router = useRouter();
  const { data, error } = useLoad(() => api.get<PlanListRow[]>('/v1/plans'), [api]);
  const [open, setOpen] = useState(false);
  const [names, setNames] = useState({ bn: '', hi: '', en: '' });
  const [saveError, setSaveError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  if (!can('plans.read')) return <Forbidden />;
  const problems = planNameProblems(names);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    try {
      const plan = await api.post<PlanDetail>('/v1/plans', {
        nameBn: names.bn,
        nameHi: names.hi,
        nameEn: names.en,
      });
      router.push(`/plans/${plan.id}`);
    } catch (err) {
      setSaveError(err);
      setSaving(false);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Neo Own plans</h1>
          <p className="muted">
            Each plan is priced per battery type. A driver keeps the version they signed.
          </p>
        </div>
        {can('plans.manage') && (
          <button
            className="primary"
            onClick={() => {
              setNames({ bn: '', hi: '', en: '' });
              setSaveError(null);
              setOpen(true);
            }}
          >
            New plan
          </button>
        )}
      </div>
      <ErrorBox error={error} />
      <div className="card table-wrap" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>Code</th>
              <th>Name</th>
              <th>Live terms</th>
              <th>Prices from</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {data?.length === 0 && (
              <tr>
                <td colSpan={5} className="empty">
                  No plans yet.
                </td>
              </tr>
            )}
            {data?.map((p) => {
              const cheapest = p.published?.prices.reduce<number | null>(
                (min, x) => (min === null || x.instalment < min ? x.instalment : min),
                null,
              );
              return (
                <tr key={p.id}>
                  <td className="mono">
                    <Link href={`/plans/${p.id}`}>{p.code}</Link>
                  </td>
                  <td>
                    <strong>{p.names.en}</strong>
                    <div className="muted" style={{ fontSize: 13 }}>
                      {p.names.bn} · {p.names.hi}
                    </div>
                  </td>
                  <td>
                    {p.published ? (
                      <>
                        v{p.published.version}: {p.published.termMonths} instalments ·{' '}
                        {p.published.prices.length} battery type
                        {p.published.prices.length === 1 ? '' : 's'}
                        {p.belowFloorNow && (
                          <div className="below">Below today&apos;s cost floor</div>
                        )}
                        {p.published.costFloorException && (
                          <div className="muted">Published by exception</div>
                        )}
                      </>
                    ) : (
                      <span className="muted">Not published</span>
                    )}
                    {p.openVersion && (
                      <div className="muted" style={{ fontSize: 13 }}>
                        v{p.openVersion.version}{' '}
                        {p.openVersion.status === 'DRAFT' ? 'draft' : 'awaiting approval'}
                      </div>
                    )}
                  </td>
                  <td>
                    {cheapest !== null && cheapest !== undefined ? (
                      <>
                        <Money paise={cheapest} /> / month
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>
                    <StatusBadge status={p.status} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="New plan">
        <form onSubmit={create}>
          <ErrorBox error={saveError} />
          <p className="muted">
            The system gives the plan a fixed code. You set the terms and prices next, as version 1.
          </p>
          <NameFields value={names} onChange={setNames} />
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button type="button" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button className="primary" type="submit" disabled={saving || problems.length > 0}>
              Create plan
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}

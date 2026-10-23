'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import {
  COST_BASIS_LABELS,
  VEHICLE_TYPE_LABELS,
  type CostBasis,
  type VehicleType,
} from '@voltneo/shared';
import { useSession } from '@/lib/session';
import type { BatteryTypeRow } from '@/lib/types';
import { CostFields, EMPTY_COST, costPayload, type CostDraft } from '@/components/CostFields';
import { BatteryTypeFields, draftFrom, typePayload } from '@/components/BatteryTypeForm';
import { ErrorBox, Modal, Money, StatusBadge, formatDate, useLoad } from '@/components/ui';

export default function BatteryTypePage() {
  const { id } = useParams<{ id: string }>();
  const { api, can } = useSession();
  const {
    data: t,
    error,
    setData,
  } = useLoad(() => api.get<BatteryTypeRow>(`/v1/battery-types/${id}`), [api, id]);
  const [editing, setEditing] = useState(false);
  const [costing, setCosting] = useState(false);
  const [draft, setDraft] = useState(draftFrom());
  const [cost, setCost] = useState<CostDraft>(EMPTY_COST);
  const [actionError, setActionError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const manage = can('battery_types.manage');

  async function run(fn: () => Promise<BatteryTypeRow>, close: () => void) {
    setBusy(true);
    setActionError(null);
    try {
      setData(await fn());
      close();
    } catch (err) {
      setActionError(err);
    } finally {
      setBusy(false);
    }
  }

  if (!t) return <ErrorBox error={error} />;
  const keys = Object.keys(COST_BASIS_LABELS) as (keyof CostBasis)[];

  return (
    <>
      <Link href="/battery-types" className="back">
        ← Battery types
      </Link>
      <div className="page-head">
        <div>
          <h1>
            {t.name} <StatusBadge status={t.status} />
          </h1>
          <p className="muted">
            {t.voltage} V · {t.capacityAh} Ah · {t.chemistry}
          </p>
        </div>
        {manage && (
          <div className="row">
            <button
              onClick={() => {
                setDraft(draftFrom(t));
                setActionError(null);
                setEditing(true);
              }}
            >
              Edit details
            </button>
            <button
              onClick={() =>
                void run(
                  () =>
                    api.patch(`/v1/battery-types/${id}`, {
                      status: t.status === 'ACTIVE' ? 'ARCHIVED' : 'ACTIVE',
                    }),
                  () => undefined,
                )
              }
              disabled={busy}
            >
              {t.status === 'ACTIVE' ? 'Archive' : 'Restore'}
            </button>
          </div>
        )}
      </div>
      {!editing && !costing && <ErrorBox error={actionError} />}
      {t.status === 'ARCHIVED' && (
        <div className="alert info">
          Archived: no new batteries or plan prices can use this type. Existing ones are unaffected.
        </div>
      )}

      <div className="card">
        <dl className="kv">
          <dt>Supplier</dt>
          <dd>{t.supplier}</dd>
          <dt>Warranty</dt>
          <dd>
            {t.warrantyMonths} months{t.warrantyNotes ? ` — ${t.warrantyNotes}` : ''}
          </dd>
          <dt>Vehicles</dt>
          <dd>
            {t.compatibleVehicles.map((v) => VEHICLE_TYPE_LABELS[v as VehicleType]).join(', ') ||
              '—'}
          </dd>
          {t.notes && (
            <>
              <dt>Notes</dt>
              <dd>{t.notes}</dd>
            </>
          )}
        </dl>
      </div>

      {t.costHistory && (
        <div className="section">
          <h2>
            Costs and cost floor
            {manage && (
              <button
                className="primary"
                onClick={() => {
                  const c = t.currentCost;
                  setCost(
                    c
                      ? {
                          purchaseCost: c.purchaseCost,
                          gpsCost: c.gpsCost,
                          serviceCost: c.serviceCost,
                          financingCost: c.financingCost,
                          collectionCost: c.collectionCost,
                          expectedLossCost: c.expectedLossCost,
                          note: '',
                        }
                      : EMPTY_COST,
                  );
                  setActionError(null);
                  setCosting(true);
                }}
              >
                Record new costs
              </button>
            )}
          </h2>
          <p className="muted">Newest first. Earlier rows are kept and cannot be changed.</p>
          <div className="card table-wrap" style={{ padding: 0 }}>
            <table>
              <thead>
                <tr>
                  <th>From</th>
                  {keys.map((k) => (
                    <th key={k} className="right">
                      {COST_BASIS_LABELS[k]}
                    </th>
                  ))}
                  <th className="right">Cost floor</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {t.costHistory.map((c, i) => (
                  <tr key={c.id} style={i === 0 ? { fontWeight: 600 } : undefined}>
                    <td>
                      {formatDate(c.createdAt, true)}
                      <div className="muted" style={{ fontSize: 12, fontWeight: 400 }}>
                        {c.enteredByName}
                      </div>
                    </td>
                    {keys.map((k) => (
                      <td key={k} className="right">
                        <Money paise={c[k]} />
                      </td>
                    ))}
                    <td className="right">
                      <Money paise={c.costFloor} />
                    </td>
                    <td className="muted" style={{ fontWeight: 400 }}>
                      {c.note}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal open={editing} onClose={() => setEditing(false)} title={`Edit ${t.name}`} wide>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(
              () => api.patch(`/v1/battery-types/${id}`, typePayload(draft)),
              () => setEditing(false),
            );
          }}
        >
          <ErrorBox error={actionError} />
          <BatteryTypeFields value={draft} onChange={setDraft} />
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button type="button" onClick={() => setEditing(false)}>
              Cancel
            </button>
            <button className="primary" type="submit" disabled={busy}>
              Save
            </button>
          </div>
        </form>
      </Modal>

      <Modal open={costing} onClose={() => setCosting(false)} title="Record new costs" wide>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(
              () => api.post(`/v1/battery-types/${id}/costs`, costPayload(cost)),
              () => setCosting(false),
            );
          }}
        >
          <ErrorBox error={actionError} />
          <p className="muted">
            New costs apply to plans published from now on. Plans already live keep their terms; the
            Plans page flags any that fall below the new floor.
          </p>
          <CostFields value={cost} onChange={setCost} />
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button type="button" onClick={() => setCosting(false)}>
              Cancel
            </button>
            <button className="primary" type="submit" disabled={busy || !cost.purchaseCost}>
              Save new costs
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}

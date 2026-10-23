'use client';

import Link from 'next/link';
import { useState } from 'react';
import { VEHICLE_TYPE_LABELS, type VehicleType } from '@voltneo/shared';
import { useSession } from '@/lib/session';
import type { BatteryTypeRow } from '@/lib/types';
import { Forbidden } from '@/components/AppShell';
import { CostFields, EMPTY_COST, costPayload, type CostDraft } from '@/components/CostFields';
import { BatteryTypeFields, draftFrom, typePayload } from '@/components/BatteryTypeForm';
import { ErrorBox, Modal, Money, StatusBadge, useLoad } from '@/components/ui';

export default function BatteryTypesPage() {
  const { api, can } = useSession();
  const { data, error, reload } = useLoad(
    () => api.get<BatteryTypeRow[]>('/v1/battery-types'),
    [api],
  );
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(draftFrom());
  const [cost, setCost] = useState<CostDraft>(EMPTY_COST);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  if (!can('battery_types.read')) return <Forbidden />;
  const showCosts = can('costs.read');

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    try {
      await api.post('/v1/battery-types', { ...typePayload(draft), cost: costPayload(cost) });
      setOpen(false);
      await reload();
    } catch (err) {
      setSaveError(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Battery types</h1>
          <p className="muted">
            The 4–5 battery types bought from the supplier, with specifications and costs.
          </p>
        </div>
        {can('battery_types.manage') && (
          <button
            className="primary"
            onClick={() => {
              setDraft(draftFrom());
              setCost(EMPTY_COST);
              setSaveError(null);
              setOpen(true);
            }}
          >
            Add battery type
          </button>
        )}
      </div>
      <ErrorBox error={error} />
      <div className="card table-wrap" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Specification</th>
              <th>Vehicles</th>
              {showCosts && <th className="right">Purchase cost</th>}
              {showCosts && <th className="right">Cost floor</th>}
              <th>Batteries</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {data?.length === 0 && (
              <tr>
                <td colSpan={7} className="empty">
                  No battery types yet. Add the first one from the supplier&apos;s specification
                  sheet.
                </td>
              </tr>
            )}
            {data?.map((t) => {
              const total = Object.values(t.batteryCounts ?? {}).reduce((a, b) => a + b, 0);
              return (
                <tr key={t.id}>
                  <td>
                    <Link href={`/battery-types/${t.id}`}>
                      <strong>{t.name}</strong>
                    </Link>
                  </td>
                  <td>
                    {t.voltage} V · {t.capacityAh} Ah · {t.chemistry}
                    <div className="muted" style={{ fontSize: 13 }}>
                      {t.supplier} · {t.warrantyMonths}-month warranty
                    </div>
                  </td>
                  <td>
                    {t.compatibleVehicles
                      .map((v) => VEHICLE_TYPE_LABELS[v as VehicleType])
                      .join(', ') || '—'}
                  </td>
                  {showCosts && (
                    <td className="right">
                      <Money paise={t.currentCost?.purchaseCost} />
                    </td>
                  )}
                  {showCosts && (
                    <td className="right">
                      <Money paise={t.currentCost?.costFloor} />
                    </td>
                  )}
                  <td>
                    {total} total
                    {t.batteryCounts?.IN_STOCK ? (
                      <span className="muted"> · {t.batteryCounts.IN_STOCK} in stock</span>
                    ) : null}
                  </td>
                  <td>
                    <StatusBadge status={t.status} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="Add battery type" wide>
        <form onSubmit={save}>
          <ErrorBox error={saveError} />
          <BatteryTypeFields value={draft} onChange={setDraft} />
          <h2 style={{ marginTop: 8 }}>Costs</h2>
          <CostFields value={cost} onChange={setCost} />
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button type="button" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button className="primary" type="submit" disabled={saving || !cost.purchaseCost}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}

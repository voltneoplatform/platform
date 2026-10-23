'use client';

import { useState } from 'react';
import { CHEMISTRY_SUGGESTIONS, VEHICLE_TYPES, VEHICLE_TYPE_LABELS } from '@voltneo/shared';
import type { BatteryTypeRow } from '@/lib/types';

export interface TypeDraft {
  name: string;
  voltage: string;
  capacityAh: string;
  chemistry: string;
  supplier: string;
  warrantyMonths: string;
  warrantyNotes: string;
  compatibleVehicles: string[];
  notes: string;
}

export function draftFrom(t?: BatteryTypeRow): TypeDraft {
  return {
    name: t?.name ?? '',
    voltage: t ? String(t.voltage) : '',
    capacityAh: t ? String(t.capacityAh) : '',
    chemistry: t?.chemistry ?? '',
    supplier: t?.supplier ?? '',
    warrantyMonths: t ? String(t.warrantyMonths) : '',
    warrantyNotes: t?.warrantyNotes ?? '',
    compatibleVehicles: t?.compatibleVehicles ?? [],
    notes: t?.notes ?? '',
  };
}

export function typePayload(d: TypeDraft) {
  return {
    name: d.name,
    voltage: Number(d.voltage),
    capacityAh: Number(d.capacityAh),
    chemistry: d.chemistry,
    supplier: d.supplier,
    warrantyMonths: Number(d.warrantyMonths),
    warrantyNotes: d.warrantyNotes || null,
    compatibleVehicles: d.compatibleVehicles,
    notes: d.notes || null,
  };
}

export function BatteryTypeFields({
  value,
  onChange,
}: {
  value: TypeDraft;
  onChange: (d: TypeDraft) => void;
}) {
  const [listId] = useState(() => `chem-${Math.random().toString(36).slice(2)}`);
  const set = (k: keyof TypeDraft) => (e: React.ChangeEvent<HTMLInputElement>) =>
    onChange({ ...value, [k]: e.target.value });
  return (
    <>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="bt-name">Name</label>
          <input
            id="bt-name"
            required
            value={value.name}
            onChange={set('name')}
            placeholder="e.g. Neo 51"
          />
          <div className="hint">Short enough for drivers and agents to say aloud.</div>
        </div>
        <div className="field">
          <label htmlFor="bt-supplier">Supplier</label>
          <input id="bt-supplier" required value={value.supplier} onChange={set('supplier')} />
        </div>
        <div className="field">
          <label htmlFor="bt-voltage">Voltage (V)</label>
          <input
            id="bt-voltage"
            required
            inputMode="decimal"
            value={value.voltage}
            onChange={set('voltage')}
          />
        </div>
        <div className="field">
          <label htmlFor="bt-capacity">Capacity (Ah)</label>
          <input
            id="bt-capacity"
            required
            inputMode="decimal"
            value={value.capacityAh}
            onChange={set('capacityAh')}
          />
        </div>
        <div className="field">
          <label htmlFor="bt-chem">Chemistry</label>
          <input
            id="bt-chem"
            required
            list={listId}
            value={value.chemistry}
            onChange={set('chemistry')}
          />
          <datalist id={listId}>
            {CHEMISTRY_SUGGESTIONS.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>
        <div className="field">
          <label htmlFor="bt-warranty">Supplier warranty (months)</label>
          <input
            id="bt-warranty"
            required
            inputMode="numeric"
            value={value.warrantyMonths}
            onChange={set('warrantyMonths')}
          />
        </div>
      </div>
      <div className="field">
        <label>Compatible vehicles</label>
        <div className="row">
          {VEHICLE_TYPES.map((v) => (
            <label key={v} className="checkbox">
              <input
                type="checkbox"
                checked={value.compatibleVehicles.includes(v)}
                onChange={(e) =>
                  onChange({
                    ...value,
                    compatibleVehicles: e.target.checked
                      ? [...value.compatibleVehicles, v]
                      : value.compatibleVehicles.filter((x) => x !== v),
                  })
                }
              />
              {VEHICLE_TYPE_LABELS[v]}
            </label>
          ))}
        </div>
      </div>
      <div className="field">
        <label htmlFor="bt-wnotes">Warranty terms</label>
        <input
          id="bt-wnotes"
          value={value.warrantyNotes}
          onChange={set('warrantyNotes')}
          placeholder="e.g. Replacement for cell failure, not misuse"
        />
      </div>
      <div className="field">
        <label htmlFor="bt-notes">Notes</label>
        <input id="bt-notes" value={value.notes} onChange={set('notes')} />
      </div>
    </>
  );
}

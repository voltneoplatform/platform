'use client';

import { COST_BASIS_LABELS, costFloor, type CostBasis } from '@voltneo/shared';
import { Money, RupeeInput } from './ui';

export type CostDraft = { [K in keyof CostBasis]: number | null } & { note: string };

export const EMPTY_COST: CostDraft = {
  purchaseCost: null,
  gpsCost: null,
  serviceCost: null,
  financingCost: null,
  collectionCost: null,
  expectedLossCost: null,
  note: '',
};

export function costPayload(c: CostDraft) {
  return {
    purchaseCost: c.purchaseCost ?? 0,
    gpsCost: c.gpsCost ?? 0,
    serviceCost: c.serviceCost ?? 0,
    financingCost: c.financingCost ?? 0,
    collectionCost: c.collectionCost ?? 0,
    expectedLossCost: c.expectedLossCost ?? 0,
    note: c.note || null,
  };
}

/** Purchase cost and cost-floor allowances, with the floor worked out as you type. */
export function CostFields({
  value,
  onChange,
}: {
  value: CostDraft;
  onChange: (c: CostDraft) => void;
}) {
  const keys = Object.keys(COST_BASIS_LABELS) as (keyof CostBasis)[];
  const p = costPayload(value);
  const floor = costFloor(p);
  return (
    <>
      <div className="form-grid">
        {keys.map((k) => (
          <div className="field" key={k}>
            <label htmlFor={`cost-${k}`}>
              {COST_BASIS_LABELS[k]}
              {k === 'purchaseCost' ? '' : ' (per battery)'}
            </label>
            <RupeeInput
              id={`cost-${k}`}
              value={value[k]}
              required={k === 'purchaseCost'}
              allowZero={k !== 'purchaseCost'}
              placeholder={k === 'purchaseCost' ? '' : '0'}
              onChange={(v) => onChange({ ...value, [k]: v })}
            />
          </div>
        ))}
      </div>
      <div className="field">
        <label htmlFor="cost-note">Note</label>
        <input
          id="cost-note"
          value={value.note}
          placeholder="e.g. Supplier quote of 20 Oct 2026"
          onChange={(e) => onChange({ ...value, note: e.target.value })}
        />
      </div>
      <div className="alert info">
        Cost floor:{' '}
        <strong>
          <Money paise={floor} />
        </strong>
        . Every plan&apos;s total payable for this battery type must be at least this much, unless a
        second person approves an exception. Allowances left blank count as ₹0.
      </div>
    </>
  );
}

'use client';

import { PLAN_LANGUAGES, PLAN_LANGUAGE_LABELS, PLAN_NAME_MAX_LENGTH } from '@voltneo/shared';

export function NameFields({
  value,
  onChange,
}: {
  value: { bn: string; hi: string; en: string };
  onChange: (v: { bn: string; hi: string; en: string }) => void;
}) {
  return (
    <>
      {PLAN_LANGUAGES.map((l) => (
        <div className="field" key={l}>
          <label htmlFor={`pn-${l}`}>{PLAN_LANGUAGE_LABELS[l]} name</label>
          <input
            id={`pn-${l}`}
            required
            lang={l}
            maxLength={PLAN_NAME_MAX_LENGTH}
            value={value[l]}
            onChange={(e) => onChange({ ...value, [l]: e.target.value })}
          />
        </div>
      ))}
      <div className="hint" style={{ marginTop: -8, marginBottom: 12 }}>
        Up to {PLAN_NAME_MAX_LENGTH} characters. Words like “cheapest”, “best”, “free” or
        “guaranteed” are not allowed.
      </div>
    </>
  );
}

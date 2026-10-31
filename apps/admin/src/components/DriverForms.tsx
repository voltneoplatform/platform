'use client';

import {
  DRIVER_LANGUAGES,
  DRIVER_LANGUAGE_LABELS,
  RELATIVE_RELATIONS,
  RELATIVE_RELATION_LABELS,
  VEHICLE_TYPES,
  VEHICLE_TYPE_LABELS,
} from '@voltneo/shared';
import type { DriverDetail, VehicleView } from '@/lib/types';

export interface DriverDraft {
  name: string;
  phone: string;
  altPhone: string;
  language: string;
  dateOfBirth: string;
  relativeRelation: string;
  relativeName: string;
  addressLine: string;
  area: string;
  district: string;
  pinCode: string;
  nomineeName: string;
  nomineeRelation: string;
  nomineePhone: string;
  notes: string;
}

export function driverDraft(d?: DriverDetail): DriverDraft {
  return {
    name: d?.name ?? '',
    phone: d?.phone.replace(/^\+91/, '') ?? '',
    altPhone: d?.altPhone?.replace(/^\+91/, '') ?? '',
    language: d?.language ?? 'BN',
    dateOfBirth: d?.dateOfBirth ?? '',
    relativeRelation: d?.relative?.relation ?? '',
    relativeName: d?.relative?.name ?? '',
    addressLine: d?.addressLine ?? '',
    area: d?.area ?? '',
    district: d?.district ?? '',
    pinCode: d?.pinCode ?? '',
    nomineeName: d?.nominee.name ?? '',
    nomineeRelation: d?.nominee.relation ?? '',
    nomineePhone: d?.nominee.phone?.replace(/^\+91/, '') ?? '',
    notes: d?.notes ?? '',
  };
}

export function driverPayload(d: DriverDraft) {
  const n = (s: string) => (s.trim() === '' ? null : s.trim());
  return {
    name: d.name,
    phone: d.phone,
    altPhone: n(d.altPhone),
    language: d.language,
    dateOfBirth: n(d.dateOfBirth),
    relativeRelation: n(d.relativeRelation),
    relativeName: n(d.relativeName),
    addressLine: d.addressLine,
    area: n(d.area),
    district: d.district,
    pinCode: d.pinCode,
    nomineeName: n(d.nomineeName),
    nomineeRelation: n(d.nomineeRelation),
    nomineePhone: n(d.nomineePhone),
    notes: n(d.notes),
  };
}

export function DriverFields({
  value,
  onChange,
}: {
  value: DriverDraft;
  onChange: (d: DriverDraft) => void;
}) {
  const f = (
    k: keyof DriverDraft,
    label: string,
    props: React.InputHTMLAttributes<HTMLInputElement> = {},
  ) => (
    <div className="field">
      <label htmlFor={`d-${k}`}>{label}</label>
      <input
        id={`d-${k}`}
        value={value[k]}
        onChange={(e) => onChange({ ...value, [k]: e.target.value })}
        {...props}
      />
    </div>
  );
  return (
    <>
      <div className="form-grid">
        {f('name', 'Full name', { required: true, minLength: 2 })}
        {f('phone', 'Mobile number', {
          required: true,
          inputMode: 'tel',
          placeholder: '98300 12345',
        })}
        {f('altPhone', 'Other number (optional)', { inputMode: 'tel' })}
        <div className="field">
          <label htmlFor="d-language">Language</label>
          <select
            id="d-language"
            value={value.language}
            onChange={(e) => onChange({ ...value, language: e.target.value })}
          >
            {DRIVER_LANGUAGES.map((l) => (
              <option key={l} value={l}>
                {DRIVER_LANGUAGE_LABELS[l]}
              </option>
            ))}
          </select>
        </div>
        {f('dateOfBirth', 'Date of birth', { type: 'date' })}
      </div>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="d-relativeRelation">Son / daughter / wife of</label>
          <select
            id="d-relativeRelation"
            required
            value={value.relativeRelation}
            onChange={(e) => onChange({ ...value, relativeRelation: e.target.value })}
          >
            <option value="">Choose…</option>
            {RELATIVE_RELATIONS.map((r) => (
              <option key={r} value={r}>
                {RELATIVE_RELATION_LABELS[r][0]!.toUpperCase() +
                  RELATIVE_RELATION_LABELS[r].slice(1)}
              </option>
            ))}
          </select>
        </div>
        {f('relativeName', "Father's or husband's name (for the agreement)", {
          required: true,
          minLength: 2,
        })}
      </div>
      <div className="form-grid">
        {f('addressLine', 'Address', { required: true, minLength: 3 })}
        {f('area', 'Area / locality')}
        {f('district', 'District', { required: true, placeholder: 'e.g. South 24 Parganas' })}
        {f('pinCode', 'PIN code', {
          required: true,
          inputMode: 'numeric',
          pattern: '[1-9][0-9]{5}',
          maxLength: 6,
        })}
      </div>
      <h3 style={{ fontSize: 15, margin: '4px 0 10px' }}>Nominee</h3>
      <p className="hint" style={{ marginTop: -6 }}>
        Who may continue the plan or pay it off if the driver dies or cannot work (D49).
      </p>
      <div className="form-grid">
        {f('nomineeName', 'Nominee name')}
        {f('nomineeRelation', 'Relation', { placeholder: 'e.g. Wife, Son' })}
        {f('nomineePhone', 'Nominee mobile', { inputMode: 'tel' })}
      </div>
    </>
  );
}

export interface VehicleDraft {
  registration: string;
  chassisNumber: string;
  type: string;
  makeModel: string;
  ownedByDriver: boolean;
  ownerName: string;
  ownerPhone: string;
}

export function vehicleDraft(v?: VehicleView | null): VehicleDraft {
  return {
    registration: v?.registration ?? '',
    chassisNumber: v?.chassisNumber ?? '',
    type: v?.type ?? 'TOTO',
    makeModel: v?.makeModel ?? '',
    ownedByDriver: v?.ownedByDriver ?? true,
    ownerName: v?.ownerName ?? '',
    ownerPhone: v?.ownerPhone?.replace(/^\+91/, '') ?? '',
  };
}

export function vehiclePayload(v: VehicleDraft) {
  const n = (s: string) => (s.trim() === '' ? null : s.trim());
  return {
    registration: n(v.registration),
    chassisNumber: n(v.chassisNumber),
    type: v.type,
    makeModel: n(v.makeModel),
    ownedByDriver: v.ownedByDriver,
    ownerName: v.ownedByDriver ? null : n(v.ownerName),
    ownerPhone: v.ownedByDriver ? null : n(v.ownerPhone),
  };
}

export function VehicleFields({
  value,
  onChange,
}: {
  value: VehicleDraft;
  onChange: (v: VehicleDraft) => void;
}) {
  const set =
    (k: keyof VehicleDraft) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      onChange({ ...value, [k]: e.target.value });
  return (
    <>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="v-type">Vehicle</label>
          <select id="v-type" value={value.type} onChange={set('type')}>
            {VEHICLE_TYPES.map((t) => (
              <option key={t} value={t}>
                {VEHICLE_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="v-reg">Registration number</label>
          <input
            id="v-reg"
            value={value.registration}
            onChange={set('registration')}
            placeholder="WB 19 AB 1234"
          />
        </div>
        <div className="field">
          <label htmlFor="v-chassis">Chassis number</label>
          <input id="v-chassis" value={value.chassisNumber} onChange={set('chassisNumber')} />
          <div className="hint">Needed if the vehicle has no registration.</div>
        </div>
        <div className="field">
          <label htmlFor="v-make">Make and model</label>
          <input id="v-make" value={value.makeModel} onChange={set('makeModel')} />
        </div>
      </div>
      <div className="field">
        <label className="checkbox">
          <input
            type="checkbox"
            checked={!value.ownedByDriver}
            onChange={(e) => onChange({ ...value, ownedByDriver: !e.target.checked })}
          />
          The driver rents this vehicle from someone else
        </label>
      </div>
      {!value.ownedByDriver && (
        <div className="form-grid">
          <div className="field">
            <label htmlFor="v-owner">Owner&apos;s name</label>
            <input id="v-owner" required value={value.ownerName} onChange={set('ownerName')} />
          </div>
          <div className="field">
            <label htmlFor="v-owner-phone">Owner&apos;s mobile</label>
            <input
              id="v-owner-phone"
              required
              inputMode="tel"
              value={value.ownerPhone}
              onChange={set('ownerPhone')}
            />
          </div>
        </div>
      )}
    </>
  );
}

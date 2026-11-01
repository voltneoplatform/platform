'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  DRIVER_LANGUAGE_LABELS,
  VEHICLE_TYPE_LABELS,
  type DriverLanguage,
  type VehicleType,
} from '@voltneo/shared';
import { useSession } from '@/lib/session';
import type { DriverDetail, DriverListRow, Paged } from '@/lib/types';
import { Forbidden } from '@/components/AppShell';
import { DriverStageBadge, PhoneCheck, PlanSelect } from '@/components/Onboarding';
import {
  DriverFields,
  VehicleFields,
  driverDraft,
  driverPayload,
  vehicleDraft,
  vehiclePayload,
} from '@/components/DriverForms';
import {
  DuplicateWarning,
  ErrorBox,
  Modal,
  Pager,
  StatusBadge,
  duplicatesOf,
  useLoad,
  type DuplicateMatch,
} from '@/components/ui';

export default function DriversPage() {
  const { api, can } = useSession();
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [stage, setStage] = useState('');
  const [page, setPage] = useState(1);
  const list = useLoad(() => {
    const q = new URLSearchParams({ page: String(page), limit: '50' });
    if (search.trim()) q.set('search', search.trim());
    if (stage) q.set('stage', stage);
    return api.get<Paged<DriverListRow>>(`/v1/drivers?${q}`);
  }, [api, search, stage, page]);

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(driverDraft());
  const [vehicle, setVehicle] = useState(vehicleDraft());
  const [withVehicle, setWithVehicle] = useState(true);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [dups, setDups] = useState<DuplicateMatch[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [planId, setPlanId] = useState('');
  const [phoneCheckId, setPhoneCheckId] = useState<string | null>(null);
  const [checkedPhone, setCheckedPhone] = useState('');

  if (!can('drivers.read')) return <Forbidden />;
  // The code confirms the number typed when it was sent (founder, 1 Nov 2026).
  const phoneConfirmed = !!phoneCheckId && checkedPhone === draft.phone;

  async function save(acknowledge = false) {
    setSaving(true);
    setSaveError(null);
    try {
      const d = await api.post<DriverDetail>('/v1/drivers', {
        ...driverPayload(draft),
        planId: planId || undefined,
        phoneCheckId: phoneCheckId ?? undefined,
        vehicle: withVehicle ? vehiclePayload(vehicle) : undefined,
        acknowledgeDuplicates: acknowledge || undefined,
      });
      router.push(`/drivers/${d.id}`);
    } catch (err) {
      const d = duplicatesOf(err);
      if (d) setDups(d);
      else setSaveError(err);
      setSaving(false);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Drivers</h1>
          <p className="muted">Registration, KYC documents, vehicle and nominee.</p>
        </div>
        {can('drivers.manage') && (
          <button
            className="primary"
            onClick={() => {
              setPlanId('');
              setPhoneCheckId(null);
              setDraft(driverDraft());
              setVehicle(vehicleDraft());
              setSaveError(null);
              setDups(null);
              setOpen(true);
            }}
          >
            Register driver
          </button>
        )}
      </div>
      <ErrorBox error={list.error} />
      <div className="filters">
        <input
          placeholder="Name, mobile or vehicle number"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          aria-label="Search"
        />
        <select
          value={stage}
          onChange={(e) => {
            setStage(e.target.value);
            setPage(1);
          }}
          aria-label="Status"
        >
          <option value="">Any status</option>
          <option value="PAPERWORK">Paperwork in progress</option>
          <option value="AWAITING_APPROVAL">Awaiting approval</option>
          <option value="REJECTED">Not approved</option>
          <option value="APPROVED">Approved: assign a battery</option>
          <option value="AGREEMENT">Agreement in progress</option>
        </select>
      </div>
      <div className="card table-wrap" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>Driver</th>
              <th>Mobile</th>
              <th>Vehicle</th>
              <th>District</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {list.data?.items.length === 0 && (
              <tr>
                <td colSpan={5} className="empty">
                  No drivers match.
                </td>
              </tr>
            )}
            {list.data?.items.map((d) => (
              <tr key={d.id}>
                <td>
                  <Link href={`/drivers/${d.id}`}>
                    <strong>{d.name}</strong>
                  </Link>
                  <div className="muted" style={{ fontSize: 13 }}>
                    {DRIVER_LANGUAGE_LABELS[d.language as DriverLanguage]}
                    {d.status !== 'ACTIVE' && (
                      <>
                        {' '}
                        · <StatusBadge status={d.status} />
                      </>
                    )}
                  </div>
                </td>
                <td className="mono">{d.phone}</td>
                <td>
                  {d.vehicle ? (
                    <>
                      <span className="mono">{d.vehicle.registration ?? 'No registration'}</span>
                      <div className="muted" style={{ fontSize: 13 }}>
                        {VEHICLE_TYPE_LABELS[d.vehicle.type as VehicleType]}
                        {!d.vehicle.ownedByDriver && ' · rented'}
                      </div>
                    </>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td>{d.district}</td>
                <td>
                  <DriverStageBadge
                    stage={d.stage}
                    agreement={d.agreement}
                    itemsDone={d.itemsDone}
                    itemsTotal={d.itemsTotal}
                  />
                  {d.pendingDocuments > 0 && (
                    <div className="muted" style={{ fontSize: 13 }}>
                      {d.pendingDocuments} to check
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {list.data && (
        <Pager page={page} limit={list.data.limit} total={list.data.total} onPage={setPage} />
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Register driver" wide>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setDups(null);
            void save();
          }}
        >
          <ErrorBox error={saveError} />
          <DriverFields value={draft} onChange={setDraft} />
          <div className="field">
            <label htmlFor="reg-plan">Plan</label>
            <PlanSelect id="reg-plan" value={planId} onChange={setPlanId} required />
            <p className="hint">Head office can change it at final approval.</p>
          </div>
          <PhoneCheck
            phone={draft.phone}
            language={draft.language}
            name={draft.name}
            checkId={phoneConfirmed ? phoneCheckId : null}
            onChange={(c) => {
              setPhoneCheckId(c);
              setCheckedPhone(draft.phone);
            }}
          />
          <h3 style={{ fontSize: 15, margin: '4px 0 10px' }}>Vehicle</h3>
          <label className="checkbox" style={{ marginBottom: 12 }}>
            <input
              type="checkbox"
              checked={withVehicle}
              onChange={(e) => setWithVehicle(e.target.checked)}
            />
            Record the vehicle now
          </label>
          {withVehicle && <VehicleFields value={vehicle} onChange={setVehicle} />}
          {dups && (
            <DuplicateWarning matches={dups} busy={saving} onConfirm={() => void save(true)} />
          )}
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button type="button" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button className="primary" type="submit" disabled={saving || !phoneConfirmed}>
              {saving ? 'Saving…' : 'Register'}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}

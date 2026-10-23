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
  const [readiness, setReadiness] = useState('');
  const [page, setPage] = useState(1);
  const list = useLoad(() => {
    const q = new URLSearchParams({ page: String(page), limit: '50' });
    if (search.trim()) q.set('search', search.trim());
    if (readiness) q.set('readiness', readiness);
    return api.get<Paged<DriverListRow>>(`/v1/drivers?${q}`);
  }, [api, search, readiness, page]);

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(driverDraft());
  const [vehicle, setVehicle] = useState(vehicleDraft());
  const [withVehicle, setWithVehicle] = useState(true);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [dups, setDups] = useState<DuplicateMatch[] | null>(null);
  const [saving, setSaving] = useState(false);

  if (!can('drivers.read')) return <Forbidden />;

  async function save(acknowledge = false) {
    setSaving(true);
    setSaveError(null);
    try {
      const d = await api.post<DriverDetail>('/v1/drivers', {
        ...driverPayload(draft),
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
          value={readiness}
          onChange={(e) => {
            setReadiness(e.target.value);
            setPage(1);
          }}
          aria-label="KYC"
        >
          <option value="">Any KYC state</option>
          <option value="ready">Ready for an agreement</option>
          <option value="not_ready">KYC incomplete</option>
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
              <th>KYC</th>
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
                  {d.ready ? (
                    <span className="badge active">Ready</span>
                  ) : (
                    <span className="badge warn">
                      {d.itemsDone} of {d.itemsTotal}
                    </span>
                  )}
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
            <button className="primary" type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Register'}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}

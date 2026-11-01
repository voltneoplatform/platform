'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useMemo, useState } from 'react';
import {
  VEHICLE_TYPE_LABELS,
  addMonths,
  buildSchedule,
  firstDueDateProblem,
  suggestFirstDueDate,
  type DueDay,
  type VehicleType,
} from '@voltneo/shared';
import { useSession } from '@/lib/session';
import type {
  AgreementDetail,
  AgreementOption,
  BatteryRow,
  DriverDetail,
  DriverListRow,
  Paged,
} from '@/lib/types';
import { Forbidden } from '@/components/AppShell';
import { ErrorBox, Money, formatDate, useLoad } from '@/components/ui';

function todayIst(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
}

/**
 * Founder, 1 Nov 2026: once head office approves a driver on a plan, head
 * office assigns a battery and the agreement is prepared with that battery's
 * serial number and IMEI. Then it is signed, the down payment is taken, and
 * the battery is installed.
 */
function NewAgreement() {
  const { api, can } = useSession();
  const router = useRouter();
  const params = useSearchParams();
  const [driverId, setDriverId] = useState(params.get('driverId') ?? '');
  const [search, setSearch] = useState('');
  const [batteryId, setBatteryId] = useState('');
  const [batterySearch, setBatterySearch] = useState('');
  const [dueDay, setDueDay] = useState<DueDay>(17);
  const [firstDueDate, setFirstDueDate] = useState(() => suggestFirstDueDate(17, todayIst()));
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const allowed = can('agreements.manage');
  const options = useLoad(
    () => (allowed ? api.get<AgreementOption[]>('/v1/agreements/options') : Promise.resolve(null)),
    [api, allowed],
  );
  const approved = useLoad(
    () =>
      api.get<Paged<DriverListRow>>(
        `/v1/drivers?${new URLSearchParams({
          stage: 'APPROVED',
          limit: '50',
          ...(search.trim().length >= 2 ? { search: search.trim() } : {}),
        })}`,
      ),
    [api, search],
  );
  const driver = useLoad(
    () => (driverId ? api.get<DriverDetail>(`/v1/drivers/${driverId}`) : Promise.resolve(null)),
    [api, driverId],
  );
  const stock = useLoad(
    () =>
      api.get<Paged<BatteryRow>>(
        `/v1/batteries?${new URLSearchParams({
          available: 'true',
          limit: '200',
          ...(batterySearch.trim() ? { search: batterySearch.trim() } : {}),
        })}`,
      ),
    [api, batterySearch],
  );

  const d = driver.data;
  const planId = d?.onboarding.plan?.id ?? null;
  const version = options.data?.find((o) => o.planId === planId) ?? null;
  const vehicleType = d?.vehicle?.type ?? null;
  const prices = useMemo(
    () =>
      (version?.prices ?? []).filter(
        (p) => !vehicleType || p.compatibleVehicles.includes(vehicleType),
      ),
    [version, vehicleType],
  );
  const batteries = (stock.data?.items ?? []).filter((b) =>
    prices.some((p) => p.batteryTypeId === b.batteryType.id),
  );
  const battery = batteries.find((b) => b.id === batteryId) ?? null;
  const price = battery
    ? (prices.find((p) => p.batteryTypeId === battery.batteryType.id) ?? null)
    : null;

  if (!allowed) return <Forbidden />;

  const dateProblem = firstDueDateProblem(firstDueDate, dueDay, todayIst());
  const schedule =
    price && version && !dateProblem
      ? buildSchedule({
          downPayment: price.downPayment,
          instalment: price.instalment,
          termMonths: version.termMonths,
          firstDueDate,
        })
      : null;
  const ready = d?.onboarding.stage === 'APPROVED';

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const a = await api.post<AgreementDetail>('/v1/agreements', {
        driverId,
        batteryId,
        dueDay,
        firstDueDate,
        notes: notes || undefined,
      });
      router.push(`/agreements/${a.id}`);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <>
      <Link href="/agreements" className="back">
        ← Agreements
      </Link>
      <div className="page-head">
        <div>
          <h1>Assign a battery</h1>
          <p className="muted">
            For a driver head office has approved. The agreement is prepared with the battery&apos;s
            serial number and IMEI. Then print it, have it signed, take the down payment, and
            install this battery.
          </p>
        </div>
      </div>
      <form onSubmit={create}>
        <div className="card">
          <h2>1. Approved driver</h2>
          {d ? (
            <>
              <p>
                <Link href={`/drivers/${d.id}`}>
                  <strong>{d.name}</strong>
                </Link>{' '}
                <span className="mono muted">{d.phone}</span>{' '}
                <button
                  type="button"
                  className="link"
                  onClick={() => {
                    setDriverId('');
                    setBatteryId('');
                  }}
                >
                  Change
                </button>
              </p>
              <p className="muted">
                Vehicle:{' '}
                {d.vehicle
                  ? `${d.vehicle.registration ?? d.vehicle.chassisNumber} (${VEHICLE_TYPE_LABELS[d.vehicle.type as VehicleType]}${d.vehicle.ownedByDriver ? '' : ', rented'})`
                  : 'none recorded'}
                <br />
                Approved plan:{' '}
                {d.onboarding.plan
                  ? `${d.onboarding.plan.names.en} (${d.onboarding.plan.code})`
                  : 'none'}
              </p>
              {!ready && (
                <div className="alert warn">
                  {d.onboarding.stage === 'AGREEMENT'
                    ? 'This driver already has an agreement in progress.'
                    : 'This driver needs final approval first (on the driver page).'}
                </div>
              )}
            </>
          ) : (
            <>
              <div className="field">
                <label htmlFor="driver-search">Find the driver</label>
                <input
                  id="driver-search"
                  placeholder="Name, mobile or vehicle number"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  autoFocus
                />
              </div>
              {approved.data?.items.length === 0 && (
                <p className="muted">No approved driver is waiting for a battery.</p>
              )}
              <ul className="timeline">
                {approved.data?.items.map((m) => (
                  <li key={m.id}>
                    <button type="button" className="link" onClick={() => setDriverId(m.id)}>
                      {m.name}
                    </button>{' '}
                    <span className="mono muted">{m.phone}</span>
                    {m.plan && <span className="muted"> · {m.plan.names.en}</span>}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        {d && ready && (
          <div className="card">
            <h2>2. Battery</h2>
            <ErrorBox error={options.error ?? stock.error} />
            {!version && options.data && (
              <div className="alert warn">
                The approved plan is no longer on offer. Approve the driver on another plan.
              </div>
            )}
            {version && prices.length === 0 && (
              <div className="alert warn">
                This plan has no price for a battery type that fits this vehicle.
              </div>
            )}
            <div className="field">
              <label htmlFor="battery-search">Serial number or IMEI</label>
              <input
                id="battery-search"
                className="mono"
                placeholder="Search batteries in stock"
                value={batterySearch}
                onChange={(e) => setBatterySearch(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="battery">Battery in stock</label>
              <select
                id="battery"
                required
                value={batteryId}
                onChange={(e) => setBatteryId(e.target.value)}
              >
                <option value="">
                  {batteries.length ? 'Choose a battery' : 'No suitable battery in stock'}
                </option>
                {batteries.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.serial} · IMEI {b.gpsDeviceId} · {b.batteryType.name}
                    {b.location ? ` · ${b.location}` : ''}
                  </option>
                ))}
              </select>
              <p className="hint">
                Only batteries in stock, with an IMEI, not held for another agreement, of a type
                this plan prices for this vehicle.
              </p>
            </div>
          </div>
        )}

        {d && ready && (
          <div className="card">
            <h2>3. Due date</h2>
            <div className="form-grid">
              <div className="field">
                <label htmlFor="due-day">Monthly due day</label>
                <select
                  id="due-day"
                  value={dueDay}
                  onChange={(e) => {
                    const day = Number(e.target.value) as DueDay;
                    setDueDay(day);
                    setFirstDueDate(suggestFirstDueDate(day, todayIst()));
                  }}
                >
                  <option value={2}>2nd of the month</option>
                  <option value={17}>17th of the month</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="first-due">First due date</label>
                <input
                  id="first-due"
                  type="date"
                  required
                  value={firstDueDate}
                  onChange={(e) => setFirstDueDate(e.target.value)}
                />
                {dateProblem ? (
                  <p className="hint" style={{ color: 'var(--danger)' }}>
                    {dateProblem}
                  </p>
                ) : (
                  <p className="hint">Install the battery at least 7 days before this date.</p>
                )}
              </div>
            </div>
          </div>
        )}

        {schedule && version && price && battery && (
          <div className="card">
            <h2>4. Check the figures</h2>
            <div className="stats">
              <div className="stat">
                <span className="muted">Down payment</span>
                <span className="value">
                  <Money paise={price.downPayment} />
                </span>
              </div>
              <div className="stat">
                <span className="muted">Monthly instalment</span>
                <span className="value">
                  <Money paise={price.instalment} />
                </span>
              </div>
              <div className="stat">
                <span className="muted">Instalments</span>
                <span className="value">{version.termMonths}</span>
              </div>
              <div className="stat">
                <span className="muted">Total payable</span>
                <span className="value">
                  <Money paise={schedule.totalPayable} />
                </span>
              </div>
            </div>
            <p className="muted" style={{ marginTop: 12 }}>
              Battery <span className="mono">{battery.serial}</span>, IMEI{' '}
              <span className="mono">{battery.gpsDeviceId}</span>. First instalment{' '}
              {formatDate(firstDueDate)}, last{' '}
              {formatDate(addMonths(firstDueDate, version.termMonths - 1))}. Late fee{' '}
              <Money paise={version.lateFeePerDayPaise} /> a day after {version.graceDays}{' '}
              days&apos; grace, for at most {version.lateFeeCapDays} days each time the driver is
              late.
            </p>
            <div className="field">
              <label htmlFor="notes">Notes (optional)</label>
              <input
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                maxLength={500}
              />
            </div>
          </div>
        )}

        <ErrorBox error={error} />
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button
            type="submit"
            className="primary"
            disabled={busy || !ready || !schedule || !battery || !d?.vehicle}
          >
            {busy ? 'Saving…' : 'Assign battery and prepare agreement'}
          </button>
        </div>
      </form>
    </>
  );
}

export default function NewAgreementPage() {
  return (
    <Suspense fallback={<div className="muted">Loading…</div>}>
      <NewAgreement />
    </Suspense>
  );
}

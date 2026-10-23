'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';
import {
  READINESS_LABELS,
  VEHICLE_TYPE_LABELS,
  addMonths,
  buildSchedule,
  firstDueDateProblem,
  suggestFirstDueDate,
  type DueDay,
  type ReadinessItem,
  type VehicleType,
} from '@voltneo/shared';
import { useSession } from '@/lib/session';
import type {
  AgreementDetail,
  AgreementOption,
  DriverDetail,
  DriverListRow,
  Paged,
} from '@/lib/types';
import { Forbidden } from '@/components/AppShell';
import { ErrorBox, Money, formatDate, useLoad } from '@/components/ui';

function todayIst(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
}

function NewAgreement() {
  const { api, can } = useSession();
  const router = useRouter();
  const params = useSearchParams();
  const [driverId, setDriverId] = useState(params.get('driverId') ?? '');
  const [search, setSearch] = useState('');
  const [planVersionId, setPlanVersionId] = useState('');
  const [batteryTypeId, setBatteryTypeId] = useState('');
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
  const matches = useLoad(
    () =>
      search.trim().length >= 2
        ? api.get<Paged<DriverListRow>>(
            `/v1/drivers?${new URLSearchParams({ search: search.trim(), limit: '8' })}`,
          )
        : Promise.resolve(null),
    [api, search],
  );
  const driver = useLoad(
    () => (driverId ? api.get<DriverDetail>(`/v1/drivers/${driverId}`) : Promise.resolve(null)),
    [api, driverId],
  );

  const version = options.data?.find((o) => o.planVersionId === planVersionId) ?? null;
  const vehicleType = driver.data?.vehicle?.type ?? null;
  const prices = useMemo(
    () =>
      (version?.prices ?? []).filter(
        (p) => !vehicleType || p.compatibleVehicles.includes(vehicleType),
      ),
    [version, vehicleType],
  );
  const price = prices.find((p) => p.batteryTypeId === batteryTypeId) ?? null;

  useEffect(() => {
    if (prices.length === 1) setBatteryTypeId(prices[0]!.batteryTypeId);
    else if (!prices.some((p) => p.batteryTypeId === batteryTypeId)) setBatteryTypeId('');
  }, [prices, batteryTypeId]);

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

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const a = await api.post<AgreementDetail>('/v1/agreements', {
        driverId,
        planVersionId,
        batteryTypeId,
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

  const d = driver.data;
  return (
    <>
      <Link href="/agreements" className="back">
        ← Agreements
      </Link>
      <div className="page-head">
        <div>
          <h1>New agreement</h1>
          <p className="muted">
            Prepare a draft. Print Schedules 1 and 5 from the draft, explain them to the driver,
            then record the signature.
          </p>
        </div>
      </div>
      <form onSubmit={create}>
        <div className="card">
          <h2>1. Driver</h2>
          {d ? (
            <>
              <p>
                <Link href={`/drivers/${d.id}`}>
                  <strong>{d.name}</strong>
                </Link>{' '}
                <span className="mono muted">{d.phone}</span>{' '}
                <button type="button" className="link" onClick={() => setDriverId('')}>
                  Change
                </button>
              </p>
              <p className="muted">
                Vehicle:{' '}
                {d.vehicle
                  ? `${d.vehicle.registration ?? d.vehicle.chassisNumber} (${VEHICLE_TYPE_LABELS[d.vehicle.type as VehicleType]}${d.vehicle.ownedByDriver ? '' : ', rented'})`
                  : 'none recorded'}
              </p>
              {!d.readiness.ready && (
                <div className="alert warn">
                  <strong>Not ready to sign yet.</strong> You can prepare the draft, but signing
                  needs:
                  <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                    {d.readiness.items
                      .filter((i) => i.applies && !i.done)
                      .map((i) => (
                        <li key={i.item}>{READINESS_LABELS[i.item as ReadinessItem]}</li>
                      ))}
                  </ul>
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
              {matches.data?.items.length === 0 && <p className="muted">No drivers match.</p>}
              <ul className="timeline">
                {matches.data?.items.map((m) => (
                  <li key={m.id}>
                    <button type="button" className="link" onClick={() => setDriverId(m.id)}>
                      {m.name}
                    </button>{' '}
                    <span className="mono muted">{m.phone}</span>{' '}
                    {m.ready ? (
                      <span className="badge active">Ready</span>
                    ) : (
                      <span className="badge warn">KYC incomplete</span>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        <div className="card">
          <h2>2. Plan and battery type</h2>
          <ErrorBox error={options.error} />
          {options.data?.length === 0 && (
            <div className="alert warn">
              No plan is published yet. Publish a plan version first.
            </div>
          )}
          <div className="form-grid">
            <div className="field">
              <label htmlFor="plan">Plan</label>
              <select
                id="plan"
                required
                value={planVersionId}
                onChange={(e) => setPlanVersionId(e.target.value)}
              >
                <option value="">Choose a plan</option>
                {options.data?.map((o) => (
                  <option key={o.planVersionId} value={o.planVersionId}>
                    {o.names.EN} ({o.planCode} v{o.version}, {o.termMonths} months)
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="type">Battery type</label>
              <select
                id="type"
                required
                value={batteryTypeId}
                onChange={(e) => setBatteryTypeId(e.target.value)}
                disabled={!version}
              >
                <option value="">
                  {version ? 'Choose a battery type' : 'Choose a plan first'}
                </option>
                {prices.map((p) => (
                  <option key={p.batteryTypeId} value={p.batteryTypeId}>
                    {p.batteryTypeName}
                  </option>
                ))}
              </select>
              {version && vehicleType && prices.length === 0 && (
                <p className="hint">This plan has no price for a battery that fits this vehicle.</p>
              )}
            </div>
          </div>
        </div>

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

        {schedule && version && price && (
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
              First instalment {formatDate(firstDueDate)}, last{' '}
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
            disabled={busy || !driverId || !schedule || !d?.vehicle}
          >
            {busy ? 'Saving…' : 'Save draft'}
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

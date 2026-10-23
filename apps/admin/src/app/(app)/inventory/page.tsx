'use client';

import Link from 'next/link';
import { useState } from 'react';
import { BATTERY_STATUSES, BATTERY_STATUS_LABELS } from '@voltneo/shared';
import { useSession } from '@/lib/session';
import type { BatteryRow, BatteryTypeRow, Paged } from '@/lib/types';
import { Forbidden } from '@/components/AppShell';
import {
  ErrorBox,
  Modal,
  Pager,
  StatusBadge,
  formatDate,
  useLoad,
  RupeeInput,
} from '@/components/ui';

const today = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

interface Common {
  batteryTypeId: string;
  purchaseDate: string;
  purchaseCost: number | null;
  location: string;
  supplierRef: string;
}

function CommonFields({
  value,
  onChange,
  types,
}: {
  value: Common;
  onChange: (v: Common) => void;
  types: BatteryTypeRow[];
}) {
  return (
    <div className="form-grid">
      <div className="field">
        <label htmlFor="b-type">Battery type</label>
        <select
          id="b-type"
          required
          value={value.batteryTypeId}
          onChange={(e) => onChange({ ...value, batteryTypeId: e.target.value })}
        >
          <option value="">Choose…</option>
          {types
            .filter((t) => t.status === 'ACTIVE')
            .map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="b-date">Purchase date</label>
        <input
          id="b-date"
          type="date"
          required
          value={value.purchaseDate}
          onChange={(e) => onChange({ ...value, purchaseDate: e.target.value })}
        />
      </div>
      <div className="field">
        <label htmlFor="b-cost">Purchase cost per battery</label>
        <RupeeInput
          id="b-cost"
          value={value.purchaseCost}
          allowZero={false}
          placeholder="Type's current cost"
          onChange={(v) => onChange({ ...value, purchaseCost: v })}
        />
      </div>
      <div className="field">
        <label htmlFor="b-loc">Location</label>
        <input
          id="b-loc"
          value={value.location}
          onChange={(e) => onChange({ ...value, location: e.target.value })}
          placeholder="e.g. Head office store"
        />
      </div>
      <div className="field">
        <label htmlFor="b-ref">Supplier invoice or batch</label>
        <input
          id="b-ref"
          value={value.supplierRef}
          onChange={(e) => onChange({ ...value, supplierRef: e.target.value })}
        />
      </div>
    </div>
  );
}

function payload(c: Common) {
  return {
    batteryTypeId: c.batteryTypeId,
    purchaseDate: c.purchaseDate,
    purchaseCost: c.purchaseCost ?? undefined,
    location: c.location || null,
    supplierRef: c.supplierRef || null,
  };
}

export default function InventoryPage() {
  const { api, can } = useSession();
  const [typeId, setTypeId] = useState('');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const types = useLoad(() => api.get<BatteryTypeRow[]>('/v1/battery-types'), [api]);
  const list = useLoad(() => {
    const q = new URLSearchParams({ page: String(page), limit: '50' });
    if (typeId) q.set('batteryTypeId', typeId);
    if (status) q.set('status', status);
    if (search.trim()) q.set('search', search.trim());
    return api.get<Paged<BatteryRow>>(`/v1/batteries?${q}`);
  }, [api, typeId, status, search, page]);

  const [mode, setMode] = useState<'none' | 'one' | 'bulk'>('none');
  const [common, setCommon] = useState<Common>({
    batteryTypeId: '',
    purchaseDate: today(),
    purchaseCost: null,
    location: '',
    supplierRef: '',
  });
  const [serial, setSerial] = useState('');
  const [gps, setGps] = useState('');
  const [lines, setLines] = useState('');
  const [saveError, setSaveError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (!can('batteries.read')) return <Forbidden />;

  const parsed = lines
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [s, g] = l.split(/[,\t;]+/).map((x) => x.trim());
      return { serial: s ?? '', gpsDeviceId: g || null };
    });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    try {
      if (mode === 'one') {
        await api.post('/v1/batteries', { ...payload(common), serial, gpsDeviceId: gps || null });
        setMessage(`Battery ${serial.toUpperCase()} registered.`);
      } else {
        const res = await api.post<{ created: number }>('/v1/batteries/bulk', {
          ...payload(common),
          items: parsed,
        });
        setMessage(`${res.created} batteries registered.`);
      }
      setMode('none');
      setSerial('');
      setGps('');
      setLines('');
      await list.reload();
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
          <h1>Battery inventory</h1>
          <p className="muted">
            Every battery by serial number and GPS device ID, with where it is and who holds it.
          </p>
        </div>
        {can('batteries.manage') && (
          <div className="row">
            <button
              onClick={() => {
                setSaveError(null);
                setMode('bulk');
              }}
            >
              Register a delivery
            </button>
            <button
              className="primary"
              onClick={() => {
                setSaveError(null);
                setMode('one');
              }}
            >
              Register battery
            </button>
          </div>
        )}
      </div>
      {message && <div className="alert success">{message}</div>}
      <ErrorBox error={list.error} />
      <div className="filters">
        <input
          placeholder="Serial or GPS ID"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          aria-label="Search"
        />
        <select
          value={typeId}
          onChange={(e) => {
            setTypeId(e.target.value);
            setPage(1);
          }}
          aria-label="Battery type"
        >
          <option value="">All types</option>
          {types.data?.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          aria-label="Status"
        >
          <option value="">Any status</option>
          {BATTERY_STATUSES.map((s) => (
            <option key={s} value={s}>
              {BATTERY_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </div>
      <div className="card table-wrap" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>Serial</th>
              <th>GPS device</th>
              <th>Type</th>
              <th>Status</th>
              <th>Where</th>
              <th>Purchased</th>
            </tr>
          </thead>
          <tbody>
            {list.data?.items.length === 0 && (
              <tr>
                <td colSpan={6} className="empty">
                  No batteries match.
                </td>
              </tr>
            )}
            {list.data?.items.map((b) => (
              <tr key={b.id}>
                <td className="mono">
                  <Link href={`/inventory/${b.id}`}>{b.serial}</Link>
                </td>
                <td className="mono">
                  {b.gpsDeviceId ?? <span className="muted">Not fitted</span>}
                </td>
                <td>{b.batteryType.name}</td>
                <td>
                  <StatusBadge status={b.status} />
                </td>
                <td>{b.location ?? <span className="muted">—</span>}</td>
                <td>{formatDate(b.purchaseDate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {list.data && (
        <Pager page={page} limit={list.data.limit} total={list.data.total} onPage={setPage} />
      )}

      <Modal
        open={mode !== 'none'}
        onClose={() => setMode('none')}
        title={mode === 'bulk' ? 'Register a delivery' : 'Register battery'}
        wide
      >
        <form onSubmit={save}>
          <ErrorBox error={saveError} />
          <CommonFields value={common} onChange={setCommon} types={types.data ?? []} />
          {mode === 'one' ? (
            <div className="form-grid">
              <div className="field">
                <label htmlFor="b-serial">Serial number</label>
                <input
                  id="b-serial"
                  required
                  className="mono"
                  value={serial}
                  onChange={(e) => setSerial(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="b-gps">GPS device ID</label>
                <input
                  id="b-gps"
                  className="mono"
                  value={gps}
                  onChange={(e) => setGps(e.target.value)}
                />
                <div className="hint">Leave blank if the GPS module is not fitted yet.</div>
              </div>
            </div>
          ) : (
            <div className="field">
              <label htmlFor="b-lines">Serial numbers, one per line</label>
              <textarea
                id="b-lines"
                className="mono"
                rows={8}
                value={lines}
                onChange={(e) => setLines(e.target.value)}
                placeholder={'NEO51-000101, GPS-8800101\nNEO51-000102, GPS-8800102'}
              />
              <div className="hint">
                Add the GPS device ID after a comma or tab (you can paste two columns from a
                spreadsheet). {parsed.length} batteries. If any line has a problem, nothing is saved
                and every problem is listed.
              </div>
            </div>
          )}
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button type="button" onClick={() => setMode('none')}>
              Cancel
            </button>
            <button
              className="primary"
              type="submit"
              disabled={saving || !common.batteryTypeId || (mode === 'bulk' && !parsed.length)}
            >
              {saving ? 'Saving…' : mode === 'bulk' ? `Register ${parsed.length}` : 'Register'}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}

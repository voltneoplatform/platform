'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { TICKET_CATEGORY_LABELS } from '@voltneo/shared';
import { useSession } from '@/lib/session';
import type { StaffDirectoryRow, TicketList } from '@/lib/types';
import { Forbidden } from '@/components/AppShell';
import {
  DeadlineText,
  NewTicketForm,
  TicketStatusBadge,
  TimingBadge,
  technicians,
} from '@/components/TicketBits';
import { ErrorBox, Modal, Pager, formatDate, useLoad } from '@/components/ui';

type View = 'active' | 'missed' | 'finished' | 'all';

const VIEWS: { key: View; label: string }[] = [
  { key: 'active', label: 'Open' },
  { key: 'missed', label: '48 hours missed' },
  { key: 'finished', label: 'Resolved or cancelled' },
  { key: 'all', label: 'All' },
];

export default function TicketsPage() {
  const { api, can } = useSession();
  const router = useRouter();
  const [view, setView] = useState<View>('active');
  const [technicianId, setTechnicianId] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const directory = useLoad(() => api.get<StaffDirectoryRow[]>('/v1/staff/directory'), [api]);
  const q = useLoad(() => {
    const p = new URLSearchParams({ page: String(page), limit: '50' });
    if (view === 'active') p.set('active', 'true');
    if (view === 'finished') p.set('active', 'false');
    if (view === 'missed') p.set('timing', 'MISSED');
    if (technicianId) p.set('technicianId', technicianId);
    if (search.trim()) p.set('search', search.trim());
    return api.get<TicketList>(`/v1/tickets?${p}`);
  }, [api, view, technicianId, search, page]);

  if (!can('tickets.read')) return <Forbidden />;
  const c = q.data?.counts;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Service tickets</h1>
          <p className="muted">
            Faults reported by drivers. A technician responds within 48 hours (D48); a missed
            deadline shows in red.
          </p>
        </div>
        {can('tickets.manage') && (
          <button className="primary" onClick={() => setAdding(true)}>
            Log a fault
          </button>
        )}
      </div>
      <ErrorBox error={q.error} />
      {c && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="stats">
            <div className="stat">
              <span className="muted">Waiting for a technician</span>
              <span className="value">{c.open}</span>
            </div>
            <div className="stat">
              <span className="muted">Technician assigned</span>
              <span className="value">{c.assigned}</span>
            </div>
            <div className="stat">
              <span className="muted">48 hours missed</span>
              <span className="value" style={c.missed ? { color: 'var(--danger)' } : undefined}>
                {c.missed}
              </span>
            </div>
          </div>
        </div>
      )}
      <div className="filters">
        <select
          value={view}
          onChange={(e) => {
            setView(e.target.value as View);
            setPage(1);
          }}
          aria-label="Show"
        >
          {VIEWS.map((v) => (
            <option key={v.key} value={v.key}>
              {v.label}
            </option>
          ))}
        </select>
        <select
          value={technicianId}
          onChange={(e) => {
            setTechnicianId(e.target.value);
            setPage(1);
          }}
          aria-label="Technician"
        >
          <option value="">All technicians</option>
          {technicians(directory.data ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <input
          placeholder="Ticket, agreement, driver or phone"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          aria-label="Search"
        />
      </div>
      <div className="card table-wrap" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>Ticket</th>
              <th>Driver</th>
              <th>Problem</th>
              <th>Deadline</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {q.data?.items.length === 0 && (
              <tr>
                <td colSpan={5} className="empty">
                  No tickets.
                </td>
              </tr>
            )}
            {q.data?.items.map((t) => (
              <tr key={t.id}>
                <td>
                  <Link href={`/tickets/${t.id}`} className="mono">
                    <strong>{t.number}</strong>
                  </Link>
                  <div className="muted" style={{ fontSize: 13 }}>
                    {formatDate(t.reportedAt, true)}
                  </div>
                </td>
                <td>
                  <Link href={`/agreements/${t.agreement.id}`}>{t.driver.name}</Link>
                  <div className="muted" style={{ fontSize: 13 }}>
                    <a href={`tel:${t.driver.phone}`} className="mono">
                      {t.driver.phone}
                    </a>
                    {t.batterySerial && <span className="mono"> · {t.batterySerial}</span>}
                  </div>
                </td>
                <td>
                  {TICKET_CATEGORY_LABELS[t.category]}
                  <div className="muted" style={{ fontSize: 13 }}>
                    {t.technicianName ?? 'No technician yet'}
                  </div>
                </td>
                <td>
                  <TimingBadge timing={t.timing} />
                  <div style={{ fontSize: 13 }}>
                    <DeadlineText t={t} />
                  </div>
                </td>
                <td>
                  <TicketStatusBadge status={t.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {q.data && <Pager page={page} limit={q.data.limit} total={q.data.total} onPage={setPage} />}
      <Modal open={adding} onClose={() => setAdding(false)} title="Log a fault" wide>
        <NewTicketForm onDone={(t) => router.push(`/tickets/${t.id}`)} />
      </Modal>
    </>
  );
}

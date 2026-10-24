'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  SERVICE_RESPONSE_HOURS,
  TICKET_CATEGORIES,
  TICKET_CATEGORY_LABELS,
  TICKET_CHANNELS,
  TICKET_CHANNEL_LABELS,
  TICKET_STATUS_LABELS,
  TICKET_TIMING_LABELS,
  hasPermission,
  type TicketCategory,
  type TicketChannel,
  type TicketStatus,
  type TicketTiming,
} from '@voltneo/shared';
import { useSession } from '@/lib/session';
import type { StaffDirectoryRow, TicketDetail, TicketRow } from '@/lib/types';
import { localToIso, nowLocal } from '@/components/AgreementBits';
import { ErrorBox, formatDate } from '@/components/ui';

const TIMING_TONE: Record<TicketTiming, string> = {
  ON_TIME: 'info',
  DUE_SOON: 'warn',
  MISSED: 'deactivated',
  MET: 'active',
  MET_LATE: 'warn',
};

/** Where a ticket stands against its 48-hour deadline; red when missed (module 10). */
export function TimingBadge({ timing }: { timing: TicketTiming }) {
  return <span className={`badge ${TIMING_TONE[timing]}`}>{TICKET_TIMING_LABELS[timing]}</span>;
}

const STATUS_TONE: Record<TicketStatus, string> = {
  OPEN: 'warn',
  ASSIGNED: 'info',
  RESOLVED: 'active',
  CANCELLED: '',
};

export function TicketStatusBadge({ status }: { status: TicketStatus }) {
  return <span className={`badge ${STATUS_TONE[status]}`}>{TICKET_STATUS_LABELS[status]}</span>;
}

/** Hours and minutes until (or since) the deadline, for open tickets. */
export function DeadlineText({ t }: { t: Pick<TicketRow, 'dueBy' | 'respondedAt' | 'status'> }) {
  if (t.respondedAt || t.status === 'RESOLVED' || t.status === 'CANCELLED') {
    return <span className="muted">by {formatDate(t.dueBy, true)}</span>;
  }
  const ms = new Date(t.dueBy).getTime() - Date.now();
  const h = Math.floor(Math.abs(ms) / 3_600_000);
  const m = Math.floor((Math.abs(ms) % 3_600_000) / 60_000);
  const span = h >= 1 ? `${h} h ${m} min` : `${m} min`;
  return ms >= 0 ? (
    <span>{span} left</span>
  ) : (
    <span style={{ color: 'var(--danger, #b42318)', fontWeight: 600 }}>{span} late</span>
  );
}

/** Staff who can do service visits, for the technician pickers. */
export function technicians(staff: StaffDirectoryRow[]) {
  return staff
    .filter((s) => hasPermission(s.role, 'tickets.resolve'))
    .sort((a, b) =>
      a.role === b.role ? a.name.localeCompare(b.name) : a.role === 'TECHNICIAN' ? -1 : 1,
    );
}

interface AgreementHit {
  id: string;
  number: string;
  state: string;
  driver: { name: string; phone: string };
  batterySerial: string | null;
}

/** Log a fault the driver reported (spec module 10). */
export function NewTicketForm({
  agreement,
  onDone,
}: {
  /** When opened from an agreement; otherwise the form searches for one. */
  agreement?: { id: string; number: string; driverName: string };
  onDone: (t: TicketDetail) => void;
}) {
  const { api } = useSession();
  const [agreementId, setAgreementId] = useState(agreement?.id ?? '');
  const [search, setSearch] = useState('');
  const [hits, setHits] = useState<AgreementHit[]>([]);
  const [category, setCategory] = useState<TicketCategory>('NOT_WORKING');
  const [channel, setChannel] = useState<TicketChannel>('PHONE');
  const [description, setDescription] = useState('');
  const [reportedAt, setReportedAt] = useState(nowLocal());
  const [technicianId, setTechnicianId] = useState('');
  const [staff, setStaff] = useState<StaffDirectoryRow[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api
      .get<StaffDirectoryRow[]>('/v1/staff/directory')
      .then(setStaff)
      .catch(() => setStaff([]));
  }, [api]);

  useEffect(() => {
    if (agreement || search.trim().length < 2) {
      setHits([]);
      return;
    }
    const t = setTimeout(() => {
      void api
        .get<{ items: AgreementHit[] }>(
          `/v1/agreements?limit=8&search=${encodeURIComponent(search.trim())}`,
        )
        .then((r) =>
          setHits(r.items.filter((a) => ['ACTIVE', 'IN_GRACE', 'IMMOBILISED'].includes(a.state))),
        )
        .catch(() => setHits([]));
    }, 250);
    return () => clearTimeout(t);
  }, [api, search, agreement]);

  const picked = hits.find((h) => h.id === agreementId);

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          onDone(
            await api.post<TicketDetail>('/v1/tickets', {
              agreementId,
              category,
              channel,
              description,
              reportedAt: localToIso(reportedAt),
              technicianId: technicianId || undefined,
            }),
          );
        } catch (err) {
          setError(err);
          setBusy(false);
        }
      }}
    >
      <p className="muted">
        A technician must respond within {SERVICE_RESPONSE_HOURS} hours of the report (D48). The
        driver gets an SMS with the ticket number.
      </p>
      {agreement ? (
        <p>
          Agreement <span className="mono">{agreement.number}</span> · {agreement.driverName}
        </p>
      ) : (
        <div className="field">
          <label htmlFor="tk-search">
            Agreement (number, driver name, phone or battery serial)
          </label>
          <input
            id="tk-search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setAgreementId('');
            }}
            autoComplete="off"
          />
          {hits.length > 0 && !picked && (
            <ul className="pick-list">
              {hits.map((h) => (
                <li key={h.id}>
                  <button type="button" className="link" onClick={() => setAgreementId(h.id)}>
                    <span className="mono">{h.number}</span> · {h.driver.name} ·{' '}
                    <span className="mono">{h.batterySerial}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {picked && (
            <p style={{ margin: '6px 0 0' }}>
              <span className="mono">{picked.number}</span> · {picked.driver.name} · battery{' '}
              <span className="mono">{picked.batterySerial}</span>
            </p>
          )}
          {search.trim().length >= 2 && hits.length === 0 && (
            <p className="muted" style={{ margin: '6px 0 0' }}>
              No agreement with a Volt Neo battery fitted matches.
            </p>
          )}
        </div>
      )}
      <div className="form-grid">
        <div className="field">
          <label htmlFor="tk-cat">Problem</label>
          <select
            id="tk-cat"
            value={category}
            onChange={(e) => setCategory(e.target.value as TicketCategory)}
          >
            {TICKET_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {TICKET_CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="tk-ch">Reported by</label>
          <select
            id="tk-ch"
            value={channel}
            onChange={(e) => setChannel(e.target.value as TicketChannel)}
          >
            {TICKET_CHANNELS.filter((c) => c !== 'APP').map((c) => (
              <option key={c} value={c}>
                {TICKET_CHANNEL_LABELS[c]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="tk-at">Reported at</label>
          <input
            id="tk-at"
            type="datetime-local"
            required
            max={nowLocal()}
            value={reportedAt}
            onChange={(e) => setReportedAt(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="tk-tech">Technician (optional)</label>
          <select
            id="tk-tech"
            value={technicianId}
            onChange={(e) => setTechnicianId(e.target.value)}
          >
            <option value="">Assign later</option>
            {technicians(staff).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.role !== 'TECHNICIAN' ? ' (manager)' : ''}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="field">
        <label htmlFor="tk-desc">What the driver says</label>
        <textarea
          id="tk-desc"
          required
          minLength={5}
          maxLength={1000}
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      <ErrorBox error={error} />
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button type="submit" className="primary" disabled={busy || !agreementId}>
          {busy ? 'Saving…' : 'Log the fault'}
        </button>
      </div>
    </form>
  );
}

/** Tickets on one agreement, for the agreement page. */
export function AgreementTickets({
  agreement,
  serviceable,
}: {
  agreement: { id: string; number: string; driverName: string };
  serviceable: boolean;
}) {
  const { api, can } = useSession();
  const [rows, setRows] = useState<TicketRow[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    void api
      .get<{ items: TicketRow[] }>(`/v1/tickets?agreementId=${agreement.id}&limit=50`)
      .then((r) => setRows(r.items))
      .catch(setError);
  }, [api, agreement.id]);

  if (!rows) return <ErrorBox error={error} />;
  if (!rows.length && !serviceable) return null;
  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>Service tickets</h2>
        {serviceable && can('tickets.manage') && !adding && (
          <button onClick={() => setAdding(true)}>Log a fault</button>
        )}
      </div>
      {adding && (
        <div style={{ marginTop: 12 }}>
          <NewTicketForm
            agreement={agreement}
            onDone={(t) => {
              window.location.href = `/tickets/${t.id}`;
            }}
          />
        </div>
      )}
      {rows.length === 0 ? (
        <p className="muted">No faults reported.</p>
      ) : (
        <ul className="timeline">
          {rows.map((t) => (
            <li key={t.id}>
              <Link href={`/tickets/${t.id}`} className="mono">
                {t.number}
              </Link>{' '}
              {TICKET_CATEGORY_LABELS[t.category]} <TicketStatusBadge status={t.status} />{' '}
              <TimingBadge timing={t.timing} />
              <div className="muted" style={{ fontSize: 13 }}>
                Reported {formatDate(t.reportedAt, true)}
                {t.technicianName && ` · ${t.technicianName}`}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

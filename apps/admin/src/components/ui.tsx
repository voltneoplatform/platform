'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { formatRupees } from '@voltneo/shared';
import { ApiError } from '@/lib/api';

/** Shows paise as rupees with Indian digit grouping. */
export function Money({ paise }: { paise: number | null | undefined }) {
  if (paise === null || paise === undefined) return <span className="muted">—</span>;
  return <span className="num">{formatRupees(paise)}</span>;
}

/** A rupee input that reports whole paise (or null when empty). */
export function RupeeInput({
  id,
  value,
  onChange,
  required,
  allowZero = true,
  placeholder,
}: {
  id?: string;
  value: number | null;
  onChange: (paise: number | null) => void;
  required?: boolean;
  allowZero?: boolean;
  placeholder?: string;
}) {
  const [text, setText] = useState(value === null ? '' : String(value / 100));
  useEffect(() => {
    const current = text.trim() === '' ? null : Math.round(Number(text) * 100);
    if (current !== value) setText(value === null ? '' : String(value / 100));
    // Only resync when the value changes from outside.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <div className="rupee-input">
      <span aria-hidden>₹</span>
      <input
        id={id}
        inputMode="decimal"
        required={required}
        placeholder={placeholder}
        value={text}
        onChange={(e) => {
          const t = e.target.value.replace(/[^\d.]/g, '');
          setText(t);
          if (t.trim() === '') return onChange(null);
          const n = Math.round(Number(t) * 100);
          if (Number.isFinite(n) && (allowZero || n > 0)) onChange(n);
        }}
      />
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const tone: Record<string, string> = {
    ACTIVE: 'active',
    PUBLISHED: 'active',
    VERIFIED: 'active',
    APPROVED: 'active',
    IN_STOCK: 'active',
    INSTALLED: 'info',
    DRAFT: '',
    PENDING: 'warn',
    PENDING_APPROVAL: 'warn',
    UNDER_REPAIR: 'warn',
    RECOVERED: 'warn',
    SUPERSEDED: '',
    ARCHIVED: 'deactivated',
    RETIRED: 'deactivated',
    REJECTED: 'deactivated',
    CANCELLED: '',
    INACTIVE: 'deactivated',
    DEACTIVATED: 'deactivated',
    TRANSFERRED: 'info',
  };
  const label = status.charAt(0) + status.slice(1).toLowerCase().replace(/_/g, ' ');
  return <span className={`badge ${tone[status] ?? ''}`}>{label}</span>;
}

/** A modal dialog using the native <dialog> element. */
export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-label={title}
      className={wide ? 'wide' : undefined}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <h2>{title}</h2>
      {open && children}
    </dialog>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  const message = error instanceof Error ? error.message : String(error);
  const body =
    error instanceof ApiError ? (error.body as Record<string, unknown> | undefined) : undefined;
  const rows = Array.isArray(body?.errors)
    ? (body.errors as { row: number; message: string }[])
    : null;
  return (
    <div className="alert error" role="alert">
      {message}
      {rows && (
        <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
          {rows.slice(0, 20).map((r, i) => (
            <li key={i}>
              Row {r.row}: {r.message}
            </li>
          ))}
          {rows.length > 20 && <li>…and {rows.length - 20} more</li>}
        </ul>
      )}
    </div>
  );
}

export interface DuplicateMatch {
  kind: 'phone' | 'registration' | 'document';
  driverId: string;
  driverName: string;
  detail: string;
}

/** Returns the duplicate matches if the API flagged a possible duplicate. */
export function duplicatesOf(error: unknown): DuplicateMatch[] | null {
  if (!(error instanceof ApiError) || error.status !== 409) return null;
  const body = error.body as { code?: string; duplicates?: DuplicateMatch[] } | undefined;
  return body?.code === 'POSSIBLE_DUPLICATE' ? (body.duplicates ?? []) : null;
}

export function DuplicateWarning({
  matches,
  onConfirm,
  busy,
}: {
  matches: DuplicateMatch[];
  onConfirm: () => void;
  busy?: boolean;
}) {
  return (
    <div className="alert info" role="alert">
      <strong>This may be a duplicate.</strong> Check these matches before saving:
      <ul style={{ margin: '8px 0', paddingLeft: 18 }}>
        {matches.map((m, i) => (
          <li key={i}>
            {m.detail}:{' '}
            <a href={`/drivers/${m.driverId}`} target="_blank" rel="noreferrer">
              {m.driverName}
            </a>
          </li>
        ))}
      </ul>
      <button type="button" onClick={onConfirm} disabled={busy}>
        These are different people — save anyway
      </button>
    </div>
  );
}

/** Loads data on mount and whenever `deps` change; `reload` refetches. */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(load, deps);
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setData(await run());
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [run]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { data, setData, error, loading, reload };
}

export function formatDate(iso: string | null | undefined, withTime = false): string {
  if (!iso) return '—';
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00+05:30` : iso);
  return d.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    dateStyle: 'medium',
    ...(withTime ? { timeStyle: 'short' } : {}),
  });
}

export function Pager({
  page,
  limit,
  total,
  onPage,
}: {
  page: number;
  limit: number;
  total: number;
  onPage: (p: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / limit));
  if (pages <= 1) return null;
  return (
    <div className="row" style={{ justifyContent: 'center', marginTop: 14 }}>
      <button disabled={page <= 1} onClick={() => onPage(page - 1)}>
        Previous
      </button>
      <span className="muted">
        Page {page} of {pages} · {total} total
      </span>
      <button disabled={page >= pages} onClick={() => onPage(page + 1)}>
        Next
      </button>
    </div>
  );
}

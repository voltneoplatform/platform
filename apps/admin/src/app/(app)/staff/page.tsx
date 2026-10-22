'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ROLES, ROLE_LABELS, type Role, type StaffProfile } from '@voltneo/shared';
import { useSession } from '@/lib/session';
import { Forbidden } from '@/components/AppShell';

type Draft = { id?: string; name: string; email: string; phone: string; role: Role };
const EMPTY: Draft = { name: '', email: '', phone: '', role: 'SUPPORT' };

function formatDate(iso: string | null): string {
  if (!iso) return 'Never';
  return new Date(iso).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

export default function StaffPage() {
  const { api, can, staff: me } = useSession();
  const [rows, setRows] = useState<StaffProfile[] | null>(null);
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const manage = can('staff.manage');

  const load = useCallback(async () => {
    const q = new URLSearchParams();
    if (role) q.set('role', role);
    if (status) q.set('status', status);
    if (search.trim()) q.set('search', search.trim());
    try {
      setRows(await api.get<StaffProfile[]>(`/v1/staff?${q}`));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [api, role, status, search]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 200);
    return () => clearTimeout(t);
  }, [load]);

  if (!can('staff.read')) return <Forbidden />;

  function openForm(s?: StaffProfile) {
    setDraft(
      s
        ? { id: s.id, name: s.name, email: s.email ?? '', phone: s.phone ?? '', role: s.role }
        : EMPTY,
    );
    setFormError(null);
    dialog.current?.showModal();
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      const body = {
        name: draft.name,
        email: draft.email || null,
        phone: draft.phone || null,
        role: draft.role,
      };
      if (draft.id) await api.patch(`/v1/staff/${draft.id}`, body);
      else await api.post('/v1/staff', body);
      dialog.current?.close();
      setMessage(
        draft.id
          ? `Saved changes to ${draft.name}.`
          : `${draft.name} can now sign in with a login code.`,
      );
      await load();
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function setActive(s: StaffProfile, active: boolean) {
    const verb = active ? 'Reactivate' : 'Deactivate';
    if (
      !window.confirm(
        `${verb} ${s.name}?${active ? '' : ' They will be signed out everywhere at once.'}`,
      )
    )
      return;
    try {
      await api.patch(`/v1/staff/${s.id}`, { status: active ? 'ACTIVE' : 'DEACTIVATED' });
      setMessage(`${s.name} ${active ? 'reactivated' : 'deactivated'}.`);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Staff and roles</h1>
          <p className="muted">
            Staff sign in with a one-time code sent to their email or mobile number.
          </p>
        </div>
        {manage && (
          <button className="primary" onClick={() => openForm()}>
            Add staff
          </button>
        )}
      </div>

      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}
      {message && (
        <div className="alert success" role="status">
          {message}
        </div>
      )}

      <div className="filters">
        <input
          placeholder="Search name, email or phone"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search"
        />
        <select value={role} onChange={(e) => setRole(e.target.value)} aria-label="Role">
          <option value="">All roles</option>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">Any status</option>
          <option value="ACTIVE">Active</option>
          <option value="DEACTIVATED">Deactivated</option>
        </select>
      </div>

      <div className="card table-wrap" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Contact</th>
              <th>Role</th>
              <th>Status</th>
              <th>Last sign-in</th>
              {manage && <th aria-label="Actions" />}
            </tr>
          </thead>
          <tbody>
            {rows === null && (
              <tr>
                <td colSpan={6} className="empty">
                  Loading…
                </td>
              </tr>
            )}
            {rows?.length === 0 && (
              <tr>
                <td colSpan={6} className="empty">
                  No staff match these filters.
                </td>
              </tr>
            )}
            {rows?.map((s) => (
              <tr key={s.id}>
                <td>
                  <strong>{s.name}</strong>
                  {s.id === me?.id && <span className="muted"> (you)</span>}
                </td>
                <td>
                  {s.email && <div>{s.email}</div>}
                  {s.phone && <div className="mono">{s.phone}</div>}
                </td>
                <td>{ROLE_LABELS[s.role]}</td>
                <td>
                  <span className={`badge ${s.status.toLowerCase()}`}>
                    {s.status === 'ACTIVE' ? 'Active' : 'Deactivated'}
                  </span>
                </td>
                <td className="muted">{formatDate(s.lastLoginAt)}</td>
                {manage && (
                  <td>
                    <div className="row" style={{ justifyContent: 'flex-end' }}>
                      <button onClick={() => openForm(s)}>Edit</button>
                      {s.id !== me?.id &&
                        (s.status === 'ACTIVE' ? (
                          <button className="danger" onClick={() => void setActive(s, false)}>
                            Deactivate
                          </button>
                        ) : (
                          <button onClick={() => void setActive(s, true)}>Reactivate</button>
                        ))}
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <dialog ref={dialog} aria-labelledby="staff-form-title">
        <form onSubmit={save}>
          <h2 id="staff-form-title">{draft.id ? 'Edit staff member' : 'Add staff member'}</h2>
          {formError && (
            <div className="alert error" role="alert">
              {formError}
            </div>
          )}
          <div className="field">
            <label htmlFor="s-name">Full name</label>
            <input
              id="s-name"
              required
              minLength={2}
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="s-email">Email</label>
            <input
              id="s-email"
              type="email"
              value={draft.email}
              onChange={(e) => setDraft({ ...draft, email: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="s-phone">Mobile number</label>
            <input
              id="s-phone"
              inputMode="tel"
              value={draft.phone}
              onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
              placeholder="98300 12345"
            />
            <div className="hint">Give at least one of email or mobile. Login codes go there.</div>
          </div>
          <div className="field">
            <label htmlFor="s-role">Role</label>
            <select
              id="s-role"
              value={draft.role}
              disabled={draft.id === me?.id}
              onChange={(e) => setDraft({ ...draft, role: e.target.value as Role })}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
            {draft.id === me?.id && <div className="hint">You cannot change your own role.</div>}
            {draft.id && draft.id !== me?.id && (
              <div className="hint">
                Changing the role signs this person out so the new role applies at once.
              </div>
            )}
          </div>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button type="button" onClick={() => dialog.current?.close()}>
              Cancel
            </button>
            <button
              className="primary"
              type="submit"
              disabled={saving || (!draft.email.trim() && !draft.phone.trim())}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}

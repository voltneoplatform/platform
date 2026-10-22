'use client';

import Link from 'next/link';
import { ROLE_LABELS } from '@voltneo/shared';
import { useSession } from '@/lib/session';

export default function HomePage() {
  const { staff, can, permissions } = useSession();
  if (!staff) return null;
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Welcome, {staff.name.split(' ')[0]}</h1>
          <p className="muted">Signed in as {ROLE_LABELS[staff.role]}</p>
        </div>
      </div>

      <div className="grid">
        {can('staff.read') && (
          <Link href="/staff" className="card" style={{ color: 'inherit' }}>
            <h2>Staff and roles</h2>
            <p className="muted">
              {can('staff.manage')
                ? 'Add staff, change roles and deactivate accounts.'
                : 'See who works where and in which role.'}
            </p>
          </Link>
        )}
        {can('audit.read') && (
          <Link href="/audit" className="card" style={{ color: 'inherit' }}>
            <h2>Audit log</h2>
            <p className="muted">Every change, who made it and when. Entries cannot be edited.</p>
          </Link>
        )}
        <div className="card">
          <h2>Platform status</h2>
          <p className="muted">
            Milestone M0 is live: secure staff sign-in and role checks. Battery types, plans and
            drivers arrive in M1.
          </p>
        </div>
      </div>

      <details style={{ marginTop: 24 }}>
        <summary className="muted">
          What your role can do ({permissions.length} permissions)
        </summary>
        <ul className="mono" style={{ columns: 2, marginTop: 10 }}>
          {permissions.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      </details>
    </>
  );
}

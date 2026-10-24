'use client';

import Link from 'next/link';
import { ROLE_LABELS, type Permission } from '@voltneo/shared';
import { useSession } from '@/lib/session';
import type { ApprovalRow } from '@/lib/types';
import { useLoad } from '@/components/ui';
import { Dashboard } from '@/components/Dashboard';

const CARDS: { href: string; title: string; text: string; permission: Permission }[] = [
  {
    href: '/drivers',
    title: 'Drivers',
    text: 'Register drivers, check KYC documents, record the vehicle and nominee.',
    permission: 'drivers.read',
  },
  {
    href: '/plans',
    title: 'Plans',
    text: 'Neo Own plans priced per battery type, with versions and the cost-floor check.',
    permission: 'plans.read',
  },
  {
    href: '/inventory',
    title: 'Inventory',
    text: 'Every battery by serial and GPS ID, where it is and who holds it.',
    permission: 'batteries.read',
  },
  {
    href: '/battery-types',
    title: 'Battery types',
    text: 'Specifications, purchase costs and cost floors.',
    permission: 'battery_types.read',
  },
  {
    href: '/tickets',
    title: 'Service tickets',
    text: 'Faults reported by drivers, the 48-hour deadline, visits and replacements.',
    permission: 'tickets.read',
  },
  {
    href: '/staff',
    title: 'Staff and roles',
    text: 'Who works where and in which role.',
    permission: 'staff.read',
  },
  {
    href: '/audit',
    title: 'Audit log',
    text: 'Every change, who made it and when. Entries cannot be edited.',
    permission: 'audit.read',
  },
];

export default function HomePage() {
  const { staff, can, permissions, api } = useSession();
  const approvals = useLoad(
    () =>
      can('approvals.request')
        ? api.get<ApprovalRow[]>('/v1/approval-requests?status=PENDING')
        : Promise.resolve([] as ApprovalRow[]),
    [api],
  );
  if (!staff) return null;
  const waitingForMe = approvals.data?.filter((a) => a.canDecide).length ?? 0;
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Welcome, {staff.name.split(' ')[0]}</h1>
          <p className="muted">Signed in as {ROLE_LABELS[staff.role]}</p>
        </div>
      </div>

      {waitingForMe > 0 && (
        <div className="alert info">
          <strong>
            {waitingForMe} request{waitingForMe === 1 ? '' : 's'} waiting for your approval.
          </strong>{' '}
          <Link href="/approvals">Review now</Link>
        </div>
      )}

      {can('reports.read') && <Dashboard />}

      <div className="grid">
        {CARDS.filter((c) => can(c.permission)).map((c) => (
          <Link key={c.href} href={c.href} className="card" style={{ color: 'inherit' }}>
            <h2>{c.title}</h2>
            <p className="muted">{c.text}</p>
          </Link>
        ))}
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

'use client';

import Link from 'next/link';
import { ROLE_LABELS, type Permission } from '@voltneo/shared';
import { useSession } from '@/lib/session';
import type { ApprovalRow, DriverListRow, Paged } from '@/lib/types';
import { formatDate, useLoad } from '@/components/ui';
import { Dashboard } from '@/components/Dashboard';

interface PendingInstallation {
  id: string;
  agreementId: string;
  agreementNumber: string;
  driverName: string;
  batterySerial: string;
  installedAt: string;
  location: string;
  recordedByName: string | null;
}

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
    text: 'Every battery by serial and IMEI, where it is and who holds it.',
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
  const installs = useLoad(
    () =>
      can('installations.verify')
        ? api.get<PendingInstallation[]>('/v1/installations/pending')
        : Promise.resolve([] as PendingInstallation[]),
    [api],
  );
  const toApprove = useLoad(
    () =>
      can('drivers.approve')
        ? api.get<Paged<DriverListRow>>('/v1/drivers?stage=AWAITING_APPROVAL&limit=50')
        : Promise.resolve(null),
    [api],
  );
  const toAssign = useLoad(
    () =>
      can('agreements.manage')
        ? api.get<Paged<DriverListRow>>('/v1/drivers?stage=APPROVED&limit=50')
        : Promise.resolve(null),
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

      {(toApprove.data?.items.length ?? 0) > 0 && (
        <div className="card">
          <h2>Drivers to approve ({toApprove.data!.total})</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            Every document is verified. Check the details and the plan, then approve or say why not.
          </p>
          <ul className="timeline">
            {toApprove.data!.items.map((d) => (
              <li key={d.id}>
                <Link href={`/drivers/${d.id}`}>{d.name}</Link>{' '}
                <span className="muted" style={{ fontSize: 13 }}>
                  <span className="mono">{d.phone}</span> · {d.district}
                  {d.plan ? ` · ${d.plan.names.en}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(toAssign.data?.items.length ?? 0) > 0 && (
        <div className="card">
          <h2>Approved drivers waiting for a battery ({toAssign.data!.total})</h2>
          <ul className="timeline">
            {toAssign.data!.items.map((d) => (
              <li key={d.id}>
                <Link href={`/agreements/new?driverId=${d.id}`}>{d.name}</Link>{' '}
                <span className="muted" style={{ fontSize: 13 }}>
                  <span className="mono">{d.phone}</span>
                  {d.plan ? ` · ${d.plan.names.en}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(installs.data?.length ?? 0) > 0 && (
        <div className="card">
          <h2>Installations to verify ({installs.data!.length})</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            Recorded in the Field App by a field agent or technician. Check the photos and readings,
            then verify or reject. The agreement starts only once verified.
          </p>
          <ul className="timeline">
            {installs.data!.map((i) => (
              <li key={i.id}>
                <Link href={`/agreements/${i.agreementId}`}>
                  {i.agreementNumber} · {i.driverName}
                </Link>{' '}
                <span className="muted" style={{ fontSize: 13 }}>
                  battery <span className="mono">{i.batterySerial}</span> · installed{' '}
                  {formatDate(i.installedAt, true)} at {i.location} · recorded by{' '}
                  {i.recordedByName ?? '—'}
                </span>
              </li>
            ))}
          </ul>
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

'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { ROLE_LABELS, type Permission } from '@voltneo/shared';
import { useSession } from '@/lib/session';

const NAV: { href: string; label: string; permission?: Permission }[] = [
  { href: '/', label: 'Home' },
  { href: '/agreements', label: 'Agreements', permission: 'agreements.read' },
  { href: '/payments', label: 'Payments', permission: 'payments.read' },
  { href: '/cash', label: 'Cash', permission: 'cash_deposits.reconcile' },
  { href: '/drivers', label: 'Drivers', permission: 'drivers.read' },
  { href: '/plans', label: 'Plans', permission: 'plans.read' },
  { href: '/inventory', label: 'Inventory', permission: 'batteries.read' },
  { href: '/battery-types', label: 'Battery types', permission: 'battery_types.read' },
  { href: '/approvals', label: 'Approvals', permission: 'approvals.request' },
  { href: '/staff', label: 'Staff and roles', permission: 'staff.read' },
  { href: '/audit', label: 'Audit log', permission: 'audit.read' },
];

/** Modules from the MVP Spec that later milestones add. Shown so head office can see what is coming. */
const COMING: { label: string; milestone: string }[] = [
  { label: 'Collections', milestone: 'M3' },
  { label: 'Service tickets', milestone: 'M4' },
  { label: 'Dashboard', milestone: 'M4' },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const { status, staff, can, signOut } = useSession();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (status === 'signed-out') router.replace('/login');
  }, [status, router]);

  if (status !== 'signed-in' || !staff) {
    return <div className="auth-page muted">Loading…</div>;
  }

  return (
    <div className="shell">
      <nav className="sidebar" aria-label="Main">
        <div className="brand">VOLT NEO</div>
        {NAV.filter((n) => !n.permission || can(n.permission)).map((n) => (
          <Link
            key={n.href}
            href={n.href}
            className={`nav-link${(n.href === '/' ? pathname === '/' : pathname.startsWith(n.href)) ? ' active' : ''}`}
          >
            {n.label}
          </Link>
        ))}
        <div className="nav-section">Coming next</div>
        {COMING.map((c) => (
          <div key={c.label} className="nav-soon">
            <span>{c.label}</span>
            <span className="badge">{c.milestone}</span>
          </div>
        ))}
        <div className="sidebar-foot">
          <div style={{ fontWeight: 600 }}>{staff.name}</div>
          <div className="muted" style={{ fontSize: 13, marginBottom: 8 }}>
            {ROLE_LABELS[staff.role]}
          </div>
          <button className="link" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </nav>
      <main className="main">{children}</main>
    </div>
  );
}

export function Forbidden() {
  return (
    <div className="card">
      <h2>Not available for your role</h2>
      <p className="muted">Ask a super admin if you need access to this page.</p>
    </div>
  );
}

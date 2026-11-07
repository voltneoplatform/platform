'use client';

import Link from 'next/link';
import { useState } from 'react';
import { REFERRER_KIND_LABELS, type ReferrerKind } from '@voltneo/shared';
import { useSession } from '@/lib/session';
import type { ReferralBoardRow, ReferralCounts } from '@/lib/types';
import { Forbidden } from '@/components/AppShell';
import { ErrorBox, Pager, useLoad } from '@/components/ui';

interface Board {
  total: number;
  page: number;
  limit: number;
  totals: ReferralCounts;
  items: ReferralBoardRow[];
}

/**
 * Referrals (founder, 7 Nov 2026): everyone who has referred drivers, drivers
 * and outside referrers, with how many were approved and got a battery.
 * Tracking only; no rewards are calculated.
 */
export default function ReferralsPage() {
  const { api, can } = useSession();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const board = useLoad(() => {
    const q = new URLSearchParams({ page: String(page), limit: '50' });
    if (search.trim()) q.set('search', search.trim());
    return api.get<Board>(`/v1/referrals?${q}`);
  }, [api, search, page]);

  if (!can('drivers.read')) return <Forbidden />;
  const t = board.data?.totals;
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Referrals</h1>
          <p className="muted">
            Who referred which drivers. A referrer is a Volt Neo driver or an outside person. Pick
            the referrer when registering a driver, or later on the driver&apos;s page.
          </p>
        </div>
      </div>
      {t && (
        <div className="stats">
          <div className="stat">
            <span className="muted">Drivers referred</span>
            <span className="value">{t.referred}</span>
          </div>
          <div className="stat">
            <span className="muted">Approved</span>
            <span className="value">{t.approved}</span>
          </div>
          <div className="stat">
            <span className="muted">Battery installed</span>
            <span className="value">{t.installed}</span>
          </div>
        </div>
      )}
      <div className="card">
        <div className="field">
          <input
            aria-label="Search referrers"
            placeholder="Name, mobile or ID"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <ErrorBox error={board.error} />
        <table>
          <thead>
            <tr>
              <th>Referrer</th>
              <th>Who</th>
              <th>Mobile</th>
              <th style={{ textAlign: 'right' }}>Referred</th>
              <th style={{ textAlign: 'right' }}>Approved</th>
              <th style={{ textAlign: 'right' }}>Battery installed</th>
            </tr>
          </thead>
          <tbody>
            {board.data?.items.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  No referrals yet.
                </td>
              </tr>
            )}
            {board.data?.items.map((r) => (
              <tr key={`${r.type}-${r.id}`}>
                <td>
                  <Link href={r.type === 'DRIVER' ? `/drivers/${r.id}` : `/referrers/${r.id}`}>
                    <strong>{r.name}</strong>
                  </Link>
                  <div className="mono muted" style={{ fontSize: 13 }}>
                    {r.code}
                  </div>
                </td>
                <td>
                  {r.type === 'DRIVER'
                    ? 'Volt Neo driver'
                    : REFERRER_KIND_LABELS[r.kind as ReferrerKind]}
                  {!r.active && <span className="badge"> Inactive</span>}
                </td>
                <td className="mono">{r.phone}</td>
                <td style={{ textAlign: 'right' }}>{r.referred}</td>
                <td style={{ textAlign: 'right' }}>{r.approved}</td>
                <td style={{ textAlign: 'right' }}>{r.installed}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {board.data && (
          <Pager page={page} limit={board.data.limit} total={board.data.total} onPage={setPage} />
        )}
      </div>
    </>
  );
}

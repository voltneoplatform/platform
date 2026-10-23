'use client';

import Link from 'next/link';
import { useState } from 'react';
import { AGREEMENT_STATES, AGREEMENT_STATE_LABELS } from '@voltneo/shared';
import { useSession } from '@/lib/session';
import type { AgreementListRow, Paged } from '@/lib/types';
import { Forbidden } from '@/components/AppShell';
import { AgreementStateBadge } from '@/components/AgreementBits';
import { ErrorBox, Money, Pager, formatDate, useLoad } from '@/components/ui';

export default function AgreementsPage() {
  const { api, can } = useSession();
  const [search, setSearch] = useState('');
  const [state, setState] = useState('');
  const [page, setPage] = useState(1);
  const list = useLoad(() => {
    const q = new URLSearchParams({ page: String(page), limit: '50' });
    if (search.trim()) q.set('search', search.trim());
    if (state) q.set('state', state);
    return api.get<Paged<AgreementListRow>>(`/v1/agreements?${q}`);
  }, [api, search, state, page]);

  if (!can('agreements.read')) return <Forbidden />;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Agreements</h1>
          <p className="muted">
            Neo Own agreements from draft to signing, down payment, installation and payments.
          </p>
        </div>
        {can('agreements.manage') && (
          <Link href="/agreements/new" className="button primary">
            New agreement
          </Link>
        )}
      </div>
      <ErrorBox error={list.error} />
      <div className="filters">
        <input
          placeholder="Agreement number, driver, mobile or battery serial"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          aria-label="Search"
        />
        <select
          value={state}
          onChange={(e) => {
            setState(e.target.value);
            setPage(1);
          }}
          aria-label="State"
        >
          <option value="">Any state</option>
          {AGREEMENT_STATES.map((s) => (
            <option key={s} value={s}>
              {AGREEMENT_STATE_LABELS[s]}
            </option>
          ))}
        </select>
      </div>
      <div className="card table-wrap" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>Agreement</th>
              <th>Driver</th>
              <th>Plan and battery</th>
              <th className="num">Paid</th>
              <th className="num">Still to pay</th>
              <th>State</th>
            </tr>
          </thead>
          <tbody>
            {list.data?.items.length === 0 && (
              <tr>
                <td colSpan={6} className="empty">
                  No agreements match.
                </td>
              </tr>
            )}
            {list.data?.items.map((a) => (
              <tr key={a.id}>
                <td>
                  <Link href={`/agreements/${a.id}`}>
                    <strong className="mono">{a.number}</strong>
                  </Link>
                  <div className="muted" style={{ fontSize: 13 }}>
                    {formatDate(a.createdAt)}
                  </div>
                </td>
                <td>
                  <Link href={`/drivers/${a.driver.id}`}>{a.driver.name}</Link>
                  <div className="muted mono" style={{ fontSize: 13 }}>
                    {a.driver.phone}
                  </div>
                </td>
                <td>
                  {a.planName} <span className="muted mono">{a.plan}</span>
                  <div className="muted" style={{ fontSize: 13 }}>
                    {a.batteryType}
                    {a.batterySerial && <span className="mono"> · {a.batterySerial}</span>}
                  </div>
                </td>
                <td className="num">
                  <Money paise={a.paid} />
                </td>
                <td className="num">
                  <Money paise={a.outstanding} />
                </td>
                <td>
                  <AgreementStateBadge state={a.state} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {list.data && (
        <Pager page={page} limit={list.data.limit} total={list.data.total} onPage={setPage} />
      )}
    </>
  );
}

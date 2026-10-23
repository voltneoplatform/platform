'use client';

import Link from 'next/link';
import { useState } from 'react';
import { PAYMENT_METHOD_LABELS, PAYMENT_METHODS, formatRupees } from '@voltneo/shared';
import { useSession } from '@/lib/session';
import type { Paged, PaymentRow } from '@/lib/types';
import { Forbidden } from '@/components/AppShell';
import { MessageStatus, allocationLabel, openBlob } from '@/components/AgreementBits';
import { ErrorBox, Money, Pager, formatDate, useLoad } from '@/components/ui';

export default function PaymentsPage() {
  const { api, can } = useSession();
  const [search, setSearch] = useState('');
  const [method, setMethod] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [error, setError] = useState<unknown>(null);
  const [message, setMessage] = useState<string | null>(null);
  const list = useLoad(() => {
    const q = new URLSearchParams({ page: String(page), limit: '50' });
    if (search.trim()) q.set('search', search.trim());
    if (method) q.set('method', method);
    if (from) q.set('from', from);
    if (to) q.set('to', to);
    return api.get<Paged<PaymentRow> & { totalAmount: number }>(`/v1/payments?${q}`);
  }, [api, search, method, from, to, page]);

  if (!can('payments.read')) return <Forbidden />;
  const canResend = can('messages.send') || can('payments.record');

  async function resend(p: PaymentRow) {
    setError(null);
    setMessage(null);
    try {
      const res = await api.post<PaymentRow>(`/v1/payments/${p.id}/resend-receipt`);
      setMessage(
        res.messages.at(-1)?.status === 'SENT'
          ? `Receipt ${p.receiptNumber} sent again.`
          : `Receipt ${p.receiptNumber} could not be sent.`,
      );
      await list.reload();
    } catch (err) {
      setError(err);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Payments</h1>
          <p className="muted">
            Every payment received, with its receipt number. Only system receipts count as proof of
            payment (clause B6). To record a payment, open the agreement.
          </p>
        </div>
      </div>
      {message && <div className="alert success">{message}</div>}
      <ErrorBox error={error ?? list.error} />
      <div className="filters">
        <input
          placeholder="Receipt, reference, agreement or driver"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          aria-label="Search"
        />
        <select
          value={method}
          onChange={(e) => {
            setMethod(e.target.value);
            setPage(1);
          }}
          aria-label="Method"
        >
          <option value="">Any method</option>
          {PAYMENT_METHODS.map((m) => (
            <option key={m} value={m}>
              {PAYMENT_METHOD_LABELS[m]}
            </option>
          ))}
        </select>
        <input
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          aria-label="From"
        />
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To" />
      </div>
      {list.data && (
        <p className="muted">
          {list.data.total} payments · {formatRupees(list.data.totalAmount)}
        </p>
      )}
      <div className="card table-wrap" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>Receipt</th>
              <th>Received</th>
              <th>Driver and agreement</th>
              <th className="num">Amount</th>
              <th>Paid towards</th>
              <th>Method</th>
              <th>SMS</th>
            </tr>
          </thead>
          <tbody>
            {list.data?.items.length === 0 && (
              <tr>
                <td colSpan={7} className="empty">
                  No payments match.
                </td>
              </tr>
            )}
            {list.data?.items.map((p) => (
              <tr key={p.id}>
                <td>
                  <button
                    className="link mono nowrap"
                    onClick={() =>
                      void openBlob(() => api.blob(`/v1/payments/${p.id}/receipt`)).catch(setError)
                    }
                  >
                    {p.receiptNumber}
                  </button>
                </td>
                <td>{formatDate(p.receivedAt, true)}</td>
                <td>
                  <Link href={`/drivers/${p.driver.id}`}>{p.driver.name}</Link>
                  <div>
                    <Link
                      href={`/agreements/${p.agreement.id}`}
                      className="mono"
                      style={{ fontSize: 13 }}
                    >
                      {p.agreement.number}
                    </Link>
                  </div>
                </td>
                <td className="num">
                  <Money paise={p.amount} />
                </td>
                <td style={{ fontSize: 13 }}>
                  {p.allocations
                    .map((x) => `${allocationLabel(x)} ${formatRupees(x.amount)}`)
                    .join(', ')}
                </td>
                <td style={{ fontSize: 13 }}>
                  {PAYMENT_METHOD_LABELS[p.method]}
                  {p.source === 'GATEWAY' && ' (gateway)'}
                  {p.collectedByName && <div className="muted">Cash with {p.collectedByName}</div>}
                  {(p.reference ?? p.providerRef) && (
                    <div className="mono muted">{p.reference ?? p.providerRef}</div>
                  )}
                </td>
                <td>
                  <MessageStatus messages={p.messages} />
                  {canResend && p.messages.at(-1)?.status === 'FAILED' && (
                    <div>
                      <button className="link" onClick={() => void resend(p)}>
                        Resend
                      </button>
                    </div>
                  )}
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

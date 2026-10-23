'use client';

import { useState } from 'react';
import {
  LEDGER_ACCOUNT_LABELS,
  ROLE_LABELS,
  formatRupees,
  type LedgerAccount,
} from '@voltneo/shared';
import { useSession } from '@/lib/session';
import type { CashDepositRow, CashHolding, LedgerBalances, Paged } from '@/lib/types';
import { Forbidden } from '@/components/AppShell';
import { localToIso, nowLocal } from '@/components/AgreementBits';
import {
  ErrorBox,
  Modal,
  Money,
  RupeeInput,
  StatusBadge,
  formatDate,
  useLoad,
} from '@/components/ui';

export default function CashPage() {
  const { api, can, staff: me } = useSession();
  const finance = can('cash_deposits.reconcile');
  const [status, setStatus] = useState<'' | 'PENDING' | 'RECONCILED'>('PENDING');
  const holdings = useLoad(
    () => (finance ? api.get<CashHolding[]>('/v1/cash/holdings') : Promise.resolve(null)),
    [api, finance],
  );
  const deposits = useLoad(() => {
    const q = new URLSearchParams({ limit: '100' });
    if (status) q.set('status', status);
    return api.get<Paged<CashDepositRow>>(`/v1/cash/deposits?${q}`);
  }, [api, status]);
  const ledger = useLoad(
    () => (finance ? api.get<LedgerBalances>('/v1/ledger/balances') : Promise.resolve(null)),
    [api, finance],
  );
  const [open, setOpen] = useState(false);
  const [agentId, setAgentId] = useState('');
  const [amount, setAmount] = useState<number | null>(null);
  const [bankReference, setBankReference] = useState('');
  const [depositedAt, setDepositedAt] = useState(nowLocal());
  const [error, setError] = useState<unknown>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!finance && !can('payments.collect_cash')) return <Forbidden />;

  const reloadAll = async () => {
    await Promise.all([holdings.reload(), deposits.reload(), ledger.reload()]);
  };

  async function record(e: React.FormEvent) {
    e.preventDefault();
    if (!amount) return;
    setBusy(true);
    setError(null);
    try {
      await api.post('/v1/cash/deposits', {
        agentId: agentId || undefined,
        amountPaise: amount,
        bankReference,
        depositedAt: localToIso(depositedAt),
      });
      setOpen(false);
      setMessage('Deposit recorded. Someone else in finance checks it against the bank statement.');
      await reloadAll();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function reconcile(d: CashDepositRow) {
    setError(null);
    setMessage(null);
    try {
      await api.post(`/v1/cash/deposits/${d.id}/reconcile`, {});
      setMessage(`Deposit ${d.bankReference} checked.`);
      await reloadAll();
    } catch (err) {
      setError(err);
    }
  }

  const agents = (holdings.data ?? []).filter((h) => h.held > 0);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Cash</h1>
          <p className="muted">
            Cash each agent holds, paid into the bank, and checked against the statement by a second
            person.
          </p>
        </div>
        <button
          className="primary"
          onClick={() => {
            setError(null);
            setAgentId(finance ? (agents[0]?.agentId ?? '') : '');
            setAmount(null);
            setBankReference('');
            setDepositedAt(nowLocal());
            setOpen(true);
          }}
        >
          Record bank deposit
        </button>
      </div>
      {message && <div className="alert success">{message}</div>}
      {!open && <ErrorBox error={error ?? holdings.error ?? deposits.error} />}

      {holdings.data && (
        <div className="card table-wrap" style={{ padding: 0 }}>
          <h2 style={{ padding: '16px 16px 0' }}>Cash held</h2>
          <table>
            <thead>
              <tr>
                <th>Agent</th>
                <th className="num">Collected</th>
                <th className="num">Paid into bank</th>
                <th className="num">Holding now</th>
                <th className="num">Awaiting check</th>
              </tr>
            </thead>
            <tbody>
              {holdings.data.length === 0 && (
                <tr>
                  <td colSpan={5} className="empty">
                    No cash collected yet.
                  </td>
                </tr>
              )}
              {holdings.data.map((h) => (
                <tr key={h.agentId}>
                  <td>
                    {h.agentName}
                    <div className="muted" style={{ fontSize: 13 }}>
                      {ROLE_LABELS[h.role as keyof typeof ROLE_LABELS] ?? h.role}
                    </div>
                  </td>
                  <td className="num">
                    <Money paise={h.collected} />
                  </td>
                  <td className="num">
                    <Money paise={h.paidIn} />
                  </td>
                  <td className="num">
                    <strong>
                      <Money paise={h.held} />
                    </strong>
                  </td>
                  <td className="num">
                    <Money paise={h.awaitingCheck} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card table-wrap" style={{ padding: 0 }}>
        <div className="row" style={{ padding: '16px 16px 0', justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0 }}>Bank deposits</h2>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as typeof status)}
            aria-label="Status"
            style={{ width: 'auto' }}
          >
            <option value="PENDING">Awaiting check</option>
            <option value="RECONCILED">Checked</option>
            <option value="">All</option>
          </select>
        </div>
        <table>
          <thead>
            <tr>
              <th>Deposited</th>
              <th>Agent</th>
              <th className="num">Amount</th>
              <th>Bank reference</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {deposits.data?.items.length === 0 && (
              <tr>
                <td colSpan={5} className="empty">
                  Nothing here.
                </td>
              </tr>
            )}
            {deposits.data?.items.map((d) => (
              <tr key={d.id}>
                <td>
                  {formatDate(d.depositedAt, true)}
                  <div className="muted" style={{ fontSize: 13 }}>
                    recorded by {d.recordedByName}
                  </div>
                </td>
                <td>{d.agentName}</td>
                <td className="num">
                  <Money paise={d.amount} />
                </td>
                <td className="mono">{d.bankReference}</td>
                <td>
                  <StatusBadge status={d.status === 'RECONCILED' ? 'VERIFIED' : 'PENDING'} />
                  {d.status === 'RECONCILED' ? (
                    <div className="muted" style={{ fontSize: 13 }}>
                      {d.reconciledByName}, {formatDate(d.reconciledAt)}
                    </div>
                  ) : (
                    finance &&
                    d.agentId !== me?.id &&
                    d.recordedById !== me?.id && (
                      <div>
                        <button className="link" onClick={() => void reconcile(d)}>
                          Found in bank statement
                        </button>
                      </div>
                    )
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {ledger.data && (
        <div className="card table-wrap" style={{ padding: 0 }}>
          <h2 style={{ padding: '16px 16px 0' }}>
            Ledger{' '}
            {ledger.data.balanced ? (
              <span className="badge active">Balanced</span>
            ) : (
              <span className="badge deactivated">Out of balance</span>
            )}
          </h2>
          <p className="muted" style={{ padding: '0 16px', fontSize: 13 }}>
            Money movements only. How these become revenue and GST is for the chartered accountant
            to set (legal items L1 and L3).
          </p>
          <table>
            <thead>
              <tr>
                <th>Account</th>
                <th className="num">Debits</th>
                <th className="num">Credits</th>
                <th className="num">Balance</th>
              </tr>
            </thead>
            <tbody>
              {ledger.data.accounts.map((x) => (
                <tr key={x.account}>
                  <td>{LEDGER_ACCOUNT_LABELS[x.account as LedgerAccount]}</td>
                  <td className="num">
                    <Money paise={x.debit} />
                  </td>
                  <td className="num">
                    <Money paise={x.credit} />
                  </td>
                  <td className="num">
                    {x.net < 0 ? `${formatRupees(-x.net)} Cr` : `${formatRupees(x.net)} Dr`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Record bank deposit">
        <form onSubmit={record}>
          {finance ? (
            <div className="field">
              <label htmlFor="dep-agent">Whose cash</label>
              <select
                id="dep-agent"
                required
                value={agentId}
                onChange={(e) => setAgentId(e.target.value)}
              >
                <option value="">Choose</option>
                {agents.map((h) => (
                  <option key={h.agentId} value={h.agentId}>
                    {h.agentName} (holding {formatRupees(h.held)})
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <p className="muted">Your own cash.</p>
          )}
          <div className="form-grid">
            <div className="field">
              <label htmlFor="dep-amount">Amount</label>
              <RupeeInput
                id="dep-amount"
                value={amount}
                onChange={setAmount}
                required
                allowZero={false}
              />
            </div>
            <div className="field">
              <label htmlFor="dep-ref">Deposit slip or transfer reference</label>
              <input
                id="dep-ref"
                required
                minLength={3}
                value={bankReference}
                onChange={(e) => setBankReference(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="dep-at">Deposited at</label>
              <input
                id="dep-at"
                type="datetime-local"
                required
                value={depositedAt}
                max={nowLocal()}
                onChange={(e) => setDepositedAt(e.target.value)}
              />
            </div>
          </div>
          <ErrorBox error={error} />
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button type="submit" className="primary" disabled={busy || !amount}>
              Record deposit
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}

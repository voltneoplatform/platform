'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  ONBOARDING_STAGE_LABELS,
  REGISTRATION_CONSENT,
  mapLink,
  type DriverLanguage,
  type OnboardingStage,
} from '@voltneo/shared';
import { useSession } from '@/lib/session';
import type { DriverDetail, PlanListRow } from '@/lib/types';
import { AgreementStateBadge } from '@/components/AgreementBits';
import { ErrorBox, formatDate, useLoad } from '@/components/ui';

/**
 * The driver's code (founder, 1 Nov 2026): read the consent line to the
 * driver, send a code to their phone, and enter the code they read out.
 */
export function PhoneCheck({
  phone,
  language,
  name,
  checkId,
  onChange,
}: {
  phone: string;
  language: string;
  name?: string;
  checkId: string | null;
  onChange: (checkId: string | null) => void;
}) {
  const { api } = useSession();
  const [sent, setSent] = useState<{ checkId: string; phone: string } | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const lang = (['BN', 'HI', 'EN'].includes(language) ? language : 'EN') as DriverLanguage;

  if (checkId) {
    return (
      <div className="alert success">
        ✓ Mobile number confirmed by the driver&apos;s code.{' '}
        <button
          type="button"
          className="link"
          onClick={() => {
            setSent(null);
            setCode('');
            onChange(null);
          }}
        >
          Start again
        </button>
      </div>
    );
  }
  return (
    <div className="card" style={{ background: 'var(--surface-2, transparent)' }}>
      <h3 style={{ marginTop: 0 }}>Confirm the mobile number</h3>
      <p className="muted" style={{ marginTop: 0 }}>
        Read this to the driver, then send the code. The driver reads the code out to you.
      </p>
      <blockquote style={{ margin: '0 0 10px', paddingLeft: 10, borderLeft: '3px solid #ccc' }}>
        {REGISTRATION_CONSENT[lang]}
        {lang !== 'EN' && (
          <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
            {REGISTRATION_CONSENT.EN}
          </div>
        )}
      </blockquote>
      <ErrorBox error={error} />
      <div className="row" style={{ alignItems: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          disabled={busy || phone.replace(/\D/g, '').length < 10}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              const r = await api.post<{ checkId: string; phone: string }>(
                '/v1/drivers/phone-codes',
                { phone, language: lang, name },
              );
              setSent(r);
              setCode('');
            } catch (err) {
              setError(err);
            } finally {
              setBusy(false);
            }
          }}
        >
          {sent ? 'Send a new code' : `Send code to ${phone || 'the number'}`}
        </button>
        {sent && (
          <>
            <div className="field" style={{ margin: 0 }}>
              <label htmlFor="reg-code">Code the driver read out</label>
              <input
                id="reg-code"
                className="mono"
                inputMode="numeric"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              />
            </div>
            <button
              type="button"
              className="primary"
              disabled={busy || code.length !== 6}
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  await api.post('/v1/drivers/phone-codes/confirm', {
                    checkId: sent.checkId,
                    code,
                  });
                  onChange(sent.checkId);
                } catch (err) {
                  setError(err);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Confirm
            </button>
          </>
        )}
      </div>
      {sent && (
        <p className="hint">
          Sent to <span className="mono">{sent.phone}</span>. It works for 10 minutes. On the test
          site the code comes to the head-office email instead of SMS.
        </p>
      )}
    </div>
  );
}

/** Active plans with a published version, to choose for a driver. */
export function usePlans() {
  const { api } = useSession();
  return useLoad(
    () =>
      api
        .get<PlanListRow[]>('/v1/plans')
        .then((rows) => rows.filter((p) => p.status === 'ACTIVE' && p.published)),
    [api],
  );
}

export function PlanSelect({
  id,
  value,
  onChange,
  required,
}: {
  id: string;
  value: string;
  onChange: (planId: string) => void;
  required?: boolean;
}) {
  const plans = usePlans();
  return (
    <>
      <select id={id} required={required} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{plans.data?.length === 0 ? 'No plan on offer' : 'Choose a plan'}</option>
        {plans.data?.map((p) => (
          <option key={p.id} value={p.id}>
            {p.names.en} ({p.code}
            {p.published?.termMonths ? `, ${p.published.termMonths} months` : ''})
          </option>
        ))}
      </select>
      <ErrorBox error={plans.error} />
    </>
  );
}

const STAGE_TONE: Record<Exclude<OnboardingStage, 'AGREEMENT'>, string> = {
  PAPERWORK: 'warn',
  AWAITING_APPROVAL: 'info',
  REJECTED: 'deactivated',
  APPROVED: 'active',
};

/** Where a driver stands: paperwork, approval, or the agreement in progress. */
export function DriverStageBadge({
  stage,
  agreement,
  itemsDone,
  itemsTotal,
}: {
  stage: OnboardingStage;
  agreement?: { id: string; number: string; state: string } | null;
  itemsDone?: number;
  itemsTotal?: number;
}) {
  if (stage === 'AGREEMENT' && agreement) {
    return (
      <>
        <AgreementStateBadge state={agreement.state} />
        <div className="muted" style={{ fontSize: 13 }}>
          <Link href={`/agreements/${agreement.id}`} className="mono">
            {agreement.number}
          </Link>
        </div>
      </>
    );
  }
  const s = stage === 'AGREEMENT' ? 'APPROVED' : stage;
  return (
    <span className={`badge ${STAGE_TONE[s]}`}>
      {s === 'PAPERWORK' && itemsTotal !== undefined
        ? `KYC ${itemsDone} of ${itemsTotal}`
        : ONBOARDING_STAGE_LABELS[s]}
    </span>
  );
}

/**
 * The onboarding card on the driver page: phone code, where registered, plan,
 * and head office's final approval (super admin, operations manager, plan manager).
 */
export function OnboardingCard({
  d,
  onChange,
}: {
  d: DriverDetail;
  onChange: (d: DriverDetail) => void;
}) {
  const { api, can } = useSession();
  const o = d.onboarding;
  const [planId, setPlanId] = useState(o.plan?.id ?? '');
  const [reason, setReason] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [checkId, setCheckId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [message, setMessage] = useState<string | null>(null);
  const approve = can('drivers.approve');
  const manage = can('drivers.manage');
  const open = o.stage === 'AGREEMENT';

  async function act(fn: () => Promise<DriverDetail>, done: string) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fn();
      onChange(res);
      setPlanId(res.onboarding.plan?.id ?? '');
      setRejecting(false);
      setReason('');
      setMessage(done);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2>Onboarding</h2>
      <p>
        <DriverStageBadge
          stage={o.stage}
          itemsDone={d.readiness.items.filter((i) => i.done).length}
          itemsTotal={d.readiness.items.length}
        />
      </p>
      {message && <div className="alert success">{message}</div>}
      <ErrorBox error={error} />
      <dl className="kv">
        <dt>Mobile number</dt>
        <dd>
          {o.phoneVerifiedAt ? (
            <>
              ✓ Confirmed by code, {formatDate(o.phoneVerifiedAt, true)}
              {o.phoneVerifiedByName ? ` (${o.phoneVerifiedByName})` : ''}
            </>
          ) : (
            <span className="badge warn">Not confirmed</span>
          )}
        </dd>
        <dt>Registered</dt>
        <dd>
          {o.registeredByName ?? '—'}
          {o.registeredAt ? (
            <>
              {' · '}
              <a href={mapLink(o.registeredAt)} target="_blank" rel="noreferrer">
                Location on map
              </a>
              {o.registeredAt.accuracyM !== null && (
                <span className="muted"> (±{Math.round(o.registeredAt.accuracyM)} m)</span>
              )}
            </>
          ) : (
            <span className="muted"> · no location (head office or before 1 Nov 2026)</span>
          )}
        </dd>
        <dt>Plan</dt>
        <dd>
          {o.plan ? `${o.plan.names.en} (${o.plan.code})` : <span className="muted">None</span>}
        </dd>
        {o.approval === 'APPROVED' && (
          <>
            <dt>Approved</dt>
            <dd>
              {formatDate(o.approvedAt, true)}
              {o.approvedByName ? ` by ${o.approvedByName}` : ''}
            </dd>
          </>
        )}
        {o.approval === 'REJECTED' && (
          <>
            <dt>Not approved</dt>
            <dd>{o.approvalReason}</dd>
          </>
        )}
      </dl>

      {manage && !o.phoneVerifiedAt && (
        <div style={{ marginTop: 10 }}>
          {verifying ? (
            <>
              <PhoneCheck
                phone={d.phone}
                language={d.language}
                name={d.name}
                checkId={checkId}
                onChange={setCheckId}
              />
              <button
                className="primary"
                disabled={busy || !checkId}
                onClick={() =>
                  void act(
                    () =>
                      api.post<DriverDetail>(`/v1/drivers/${d.id}/verify-phone`, {
                        phoneCheckId: checkId,
                      }),
                    'Mobile number confirmed.',
                  )
                }
              >
                Save confirmation
              </button>
            </>
          ) : (
            <button onClick={() => setVerifying(true)}>Confirm mobile number by code</button>
          )}
        </div>
      )}

      {manage && !approve && o.approval !== 'APPROVED' && !open && (
        <div className="field" style={{ marginTop: 10 }}>
          <label htmlFor="ob-plan">Plan</label>
          <PlanSelect
            id="ob-plan"
            value={planId}
            onChange={(v) => {
              setPlanId(v);
              void act(
                () => api.patch<DriverDetail>(`/v1/drivers/${d.id}`, { planId: v }),
                'Plan saved.',
              );
            }}
          />
        </div>
      )}

      {manage && o.approval === 'REJECTED' && !open && (
        <button
          style={{ marginTop: 10 }}
          disabled={busy}
          onClick={() =>
            void act(
              () => api.post<DriverDetail>(`/v1/drivers/${d.id}/resubmit`, {}),
              'Sent for approval again.',
            )
          }
        >
          Send for approval again
        </button>
      )}

      {approve && !open && (
        <div style={{ marginTop: 12, borderTop: '1px solid var(--border, #ddd)', paddingTop: 10 }}>
          <h3 style={{ marginTop: 0 }}>Final approval</h3>
          {!d.readiness.ready && (
            <p className="muted">Every item on the checklist must be done before approval.</p>
          )}
          <div className="field">
            <label htmlFor="ap-plan">Plan</label>
            <PlanSelect id="ap-plan" value={planId} onChange={setPlanId} />
            <p className="hint">Check the plan the field agent chose; change it here if needed.</p>
          </div>
          {rejecting ? (
            <>
              <div className="field">
                <label htmlFor="ap-reason">Why not approved (the field agent sees this)</label>
                <input
                  id="ap-reason"
                  value={reason}
                  minLength={5}
                  maxLength={300}
                  onChange={(e) => setReason(e.target.value)}
                />
              </div>
              <div className="row">
                <button type="button" onClick={() => setRejecting(false)}>
                  Back
                </button>
                <button
                  className="danger"
                  disabled={busy || reason.trim().length < 5}
                  onClick={() =>
                    void act(
                      () => api.post<DriverDetail>(`/v1/drivers/${d.id}/reject`, { reason }),
                      'Not approved. The field agent can fix it and send it again.',
                    )
                  }
                >
                  Confirm: not approved
                </button>
              </div>
            </>
          ) : (
            <div className="row">
              <button
                className="primary"
                disabled={busy || !planId || !d.readiness.ready || d.status !== 'ACTIVE'}
                onClick={() =>
                  void act(
                    () => api.post<DriverDetail>(`/v1/drivers/${d.id}/approve`, { planId }),
                    o.approval === 'APPROVED' ? 'Plan changed.' : 'Approved.',
                  )
                }
              >
                {o.approval === 'APPROVED' ? 'Save plan' : 'Approve'}
              </button>
              {o.approval !== 'REJECTED' && (
                <button type="button" onClick={() => setRejecting(true)}>
                  Not approved…
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {o.approval === 'APPROVED' && !open && can('agreements.manage') && (
        <p style={{ marginTop: 12 }}>
          <Link href={`/agreements/new?driverId=${d.id}`} className="button primary">
            Assign a battery and prepare the agreement
          </Link>
        </p>
      )}

      {o.decisions.length > 0 && (
        <>
          <h3>History</h3>
          <ul className="timeline">
            {o.decisions.map((x) => (
              <li key={x.id}>
                <strong>{x.decision === 'APPROVED' ? 'Approved' : 'Not approved'}</strong>
                {x.plan ? ` on ${x.plan.names.en}` : ''}
                {x.reason ? `: ${x.reason}` : ''}
                <div className="muted" style={{ fontSize: 13 }}>
                  {x.decidedByName ?? '—'} · {formatDate(x.decidedAt, true)}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useRef, useState } from 'react';
import {
  DRIVER_LANGUAGE_LABELS,
  PAYMENT_METHOD_LABELS,
  READINESS_LABELS,
  mapLink,
  ROLE_LABELS,
  VEHICLE_TYPE_LABELS,
  formatRupees,
  hasPermission,
  ordinal,
  suggestFirstDueDate,
  type DueDay,
  type ReadinessItem,
  type VehicleType,
} from '@voltneo/shared';
import { useSession } from '@/lib/session';
import type {
  AgreementDetail,
  BatteryRow,
  Lang,
  Paged,
  PaymentRow,
  StaffDirectoryRow,
} from '@/lib/types';
import {
  AgreementStateBadge,
  MessageStatus,
  PaymentForm,
  allocationLabel,
  localToIso,
  nowLocal,
  openBlob,
  openLink,
} from '@/components/AgreementBits';
import { CollectionsPanel } from '@/components/CollectionsPanel';
import { OwnershipPanel } from '@/components/OwnershipPanel';
import { PaymentLinksCard } from '@/components/PaymentLinksCard';
import { AutopayCard } from '@/components/AutopayCard';
import { AgreementTickets } from '@/components/TicketBits';
import { ErrorBox, Modal, Money, formatDate, useLoad } from '@/components/ui';

type Dialog =
  'none' | 'edit' | 'sign' | 'cancel' | 'pay' | 'install' | 'reschedule' | 'battery' | 'resign';
const LANGS: Lang[] = ['BN', 'HI', 'EN'];

function todayIst(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
}

export default function AgreementPage() {
  const { id } = useParams<{ id: string }>();
  const { api, can, staff: me } = useSession();
  const {
    data: a,
    error,
    setData,
    reload,
  } = useLoad(() => api.get<AgreementDetail>(`/v1/agreements/${id}`), [api, id]);
  const payments = useLoad(
    () =>
      can('payments.read')
        ? api.get<Paged<PaymentRow>>(`/v1/agreements/${id}/payments?limit=200`)
        : Promise.resolve(null),
    [api, id],
  );
  const directory = useLoad(() => api.get<StaffDirectoryRow[]>('/v1/staff/directory'), [api]);
  const [dialog, setDialog] = useState<Dialog>('none');
  const [actionError, setActionError] = useState<unknown>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function act(fn: () => Promise<AgreementDetail | void>, done?: string) {
    setBusy(true);
    setActionError(null);
    setMessage(null);
    try {
      const res = await fn();
      if (res) setData(res);
      else await reload();
      setDialog('none');
      if (done) setMessage(done);
      void payments.reload();
    } catch (err) {
      setActionError(err);
    } finally {
      setBusy(false);
    }
  }

  function open(next: Dialog) {
    setActionError(null);
    setDialog(next);
  }

  if (!a) return <ErrorBox error={error} />;

  const manage = can('agreements.manage');
  const staff = directory.data ?? [];
  const nextAmount =
    a.state === 'AWAITING_DOWN_PAYMENT'
      ? a.schedule[0]!.amount - a.schedule[0]!.amountPaid
      : a.money.outstanding + a.money.lateFeesDue;

  const vehicle = a.vehicle.registration ?? `Chassis ${a.vehicle.chassisNumber}`;

  return (
    <>
      <Link href="/agreements" className="back">
        ← Agreements
      </Link>
      <div className="page-head">
        <div>
          <h1>
            <span className="mono">{a.number}</span> <AgreementStateBadge state={a.state} />
          </h1>
          <p className="muted">
            <Link href={`/drivers/${a.driver.id}`}>{a.driver.name}</Link> ·{' '}
            <span className="mono">{a.driver.phone}</span> · {a.plan.names.EN} ({a.plan.code} v
            {a.plan.version})
          </p>
        </div>
        <div className="row">
          {a.allowed.pay && (can('payments.record') || can('payments.collect_cash')) && (
            <button className="primary" onClick={() => open('pay')}>
              Record payment
            </button>
          )}
          {a.allowed.sign && manage && (
            <button className="primary" onClick={() => open('sign')}>
              Record signature
            </button>
          )}
          {a.allowed.install && can('installations.record') && (
            <button className="primary" onClick={() => open('install')}>
              Record installation
            </button>
          )}
          {a.allowed.resign && manage && (
            <button className="primary" onClick={() => open('resign')}>
              Record corrected agreement
            </button>
          )}
          {a.allowed.edit && manage && <button onClick={() => open('edit')}>Edit draft</button>}
          {a.allowed.changeBattery && manage && (
            <button onClick={() => open('battery')}>
              {a.battery ? 'Change battery' : 'Assign battery'}
            </button>
          )}
          {a.allowed.reschedule && manage && can('approvals.request') && !a.pendingVariation && (
            <button onClick={() => open('reschedule')}>Move first due date</button>
          )}
          {a.allowed.cancel && manage && (
            <button className="danger" onClick={() => open('cancel')}>
              Cancel
            </button>
          )}
        </div>
      </div>
      {message && <div className="alert success">{message}</div>}
      {dialog === 'none' && <ErrorBox error={actionError} />}
      {a.resignRequired && (
        <div className="alert warn">
          <strong>The battery was changed after signing.</strong> Print the agreement again (it
          shows the new serial number and IMEI), have the driver sign it, and record the corrected
          agreement before installation.
        </div>
      )}
      {a.state === 'DRAFT' && a.readiness && !a.readiness.ready && (
        <div className="alert warn">
          <strong>The driver is not ready to sign.</strong> Still needed:{' '}
          {a.readiness.items
            .filter((i) => i.applies && !i.done)
            .map((i) => READINESS_LABELS[i.item as ReadinessItem])
            .join('; ')}
          . <Link href={`/drivers/${a.driver.id}`}>Open the driver</Link>
        </div>
      )}
      {a.state === 'DRAFT' && a.plan.versionStatus !== 'PUBLISHED' && (
        <div className="alert warn">
          This plan version is no longer offered. Edit the draft to pick the current version.
        </div>
      )}
      {a.pendingVariation && (
        <div className="alert info">
          Waiting for approval: {a.pendingVariation.summary}.{' '}
          <Link href="/approvals">Approvals</Link>
        </div>
      )}
      {a.state === 'CANCELLED' && (
        <div className="alert info">
          Cancelled {formatDate(a.cancelledAt, true)}: {a.cancelReason}
        </div>
      )}

      <div className="card">
        <div className="stats">
          <div className="stat">
            <span className="muted">Total payable</span>
            <span className="value">
              <Money paise={a.terms.totalPayable} />
            </span>
          </div>
          <div className="stat">
            <span className="muted">Paid</span>
            <span className="value">
              <Money paise={a.money.paid} />
            </span>
          </div>
          <div className="stat">
            <span className="muted">Still to pay</span>
            <span className="value">
              <Money paise={a.money.outstanding} />
            </span>
          </div>
          <div className="stat">
            <span className="muted">Late fees due</span>
            <span className="value">
              <Money paise={a.money.lateFeesDue} />
            </span>
          </div>
          <div className="stat">
            <span className="muted">Next due</span>
            <span className="value" style={{ fontSize: 16 }}>
              {a.money.nextDue ? (
                <>
                  <Money paise={a.money.nextDue.amountLeft} />{' '}
                  <span className="muted" style={{ fontWeight: 400 }}>
                    {a.money.nextDue.dueDate ? formatDate(a.money.nextDue.dueDate) : 'down payment'}
                  </span>
                </>
              ) : (
                '—'
              )}
            </span>
          </div>
        </div>
      </div>

      {can('collections.read') &&
        !['DRAFT', 'AWAITING_DOWN_PAYMENT', 'AWAITING_INSTALLATION', 'CANCELLED'].includes(
          a.state,
        ) && (
          <CollectionsPanel
            agreementId={a.id}
            battery={a.battery}
            onChanged={() => {
              void reload();
              void payments.reload();
            }}
          />
        )}

      {['ACTIVE', 'IN_GRACE', 'IMMOBILISED', 'PAID_OFF', 'EARLY_EXIT', 'TRANSFERRED'].includes(
        a.state,
      ) && (
        <OwnershipPanel
          refreshKey={`${a.state}-${a.money.paid}`}
          agreementId={a.id}
          onChanged={() => {
            void reload();
            void payments.reload();
          }}
        />
      )}
      {can('tickets.read') &&
        !['DRAFT', 'AWAITING_DOWN_PAYMENT', 'AWAITING_INSTALLATION', 'CANCELLED'].includes(
          a.state,
        ) && (
          <AgreementTickets
            agreement={{ id: a.id, number: a.number, driverName: a.driver.name }}
            serviceable={['ACTIVE', 'IN_GRACE', 'IMMOBILISED'].includes(a.state)}
          />
        )}

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
        <div className="card">
          <h2>Terms</h2>
          <dl className="kv">
            <dt>Vehicle</dt>
            <dd>
              {vehicle} ({VEHICLE_TYPE_LABELS[a.vehicle.type as VehicleType]}
              {a.vehicle.ownedByDriver ? '' : ', rented'})
            </dd>
            <dt>Battery type</dt>
            <dd>
              {a.batteryType.name} ({a.batteryType.voltage} V, {a.batteryType.capacityAh} Ah)
            </dd>
            <dt>Battery</dt>
            <dd>
              {a.battery ? (
                <Link href={`/inventory/${a.battery.id}`} className="mono">
                  {a.battery.serial}
                </Link>
              ) : (
                <span className="muted">Not assigned</span>
              )}
              {a.battery?.gpsDeviceId && (
                <span className="muted mono"> · IMEI {a.battery.gpsDeviceId}</span>
              )}
              {a.batteryChanges.length > 0 && (
                <ul className="timeline" style={{ marginTop: 6 }}>
                  {a.batteryChanges.map((c) => (
                    <li key={c.id} style={{ fontSize: 13 }}>
                      Changed from <span className="mono">{c.fromSerial}</span> to{' '}
                      <span className="mono">{c.toSerial}</span>
                      {c.afterSigning ? ' after signing' : ''}: {c.reason}
                      <div className="muted">
                        {c.changedByName ?? '—'} · {formatDate(c.changedAt, true)}
                        {c.afterSigning &&
                          (c.resigned
                            ? ` · corrected agreement signed ${formatDate(c.resigned.signedAt, true)}`
                            : ' · corrected agreement not yet signed')}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </dd>
            <dt>Down payment</dt>
            <dd>
              <Money paise={a.terms.downPayment} />
            </dd>
            <dt>Instalments</dt>
            <dd>
              {a.terms.termMonths} × <Money paise={a.terms.instalment} /> on the{' '}
              {ordinal(a.terms.dueDay)}
            </dd>
            <dt>First and last due</dt>
            <dd>
              {formatDate(a.terms.firstDueDate)} – {formatDate(a.terms.lastDueDate)}
            </dd>
            <dt>Late fee</dt>
            <dd>
              <Money paise={a.terms.lateFeePerDayPaise} /> a day after {a.terms.graceDays} days, at
              most {a.terms.lateFeeCapDays} days per late spell
            </dd>
            <dt>Language</dt>
            <dd>{DRIVER_LANGUAGE_LABELS[a.language]}</dd>
            {a.notes && (
              <>
                <dt>Notes</dt>
                <dd>{a.notes}</dd>
              </>
            )}
          </dl>
        </div>

        <div className="card">
          <h2>Documents</h2>
          <p className="muted" style={{ fontSize: 13 }}>
            Wording {a.documentVersion}, schedule revision {a.scheduleRevision}. Draft wording: not
            yet reviewed by a lawyer or native-speaker translators.
          </p>
          <div className="stamp-print">
            <div>
              <strong>Full agreement for stamp paper</strong>
              <div className="muted" style={{ fontSize: 13 }}>
                English, A4. Print page 1 on the stamp paper: its top half is left blank for the
                stamp. Both parties initial every page; the driver signs Schedules 1, 4 and 6.
              </div>
            </div>
            <button
              onClick={() =>
                void openBlob(() => api.blob(`/v1/agreements/${a.id}/documents/agreement`)).catch(
                  setActionError,
                )
              }
            >
              Print agreement
            </button>
          </div>
          <div className="doc-grid">
            {(['schedule-1', 'schedule-5'] as const).map((doc) => (
              <DocRow
                key={doc}
                label={doc === 'schedule-1' ? 'Schedule 1: Plan' : 'Schedule 5: Key facts'}
                onOpen={(lang) =>
                  void openBlob(() =>
                    api.blob(`/v1/agreements/${a.id}/documents/${doc}?lang=${lang}`),
                  ).catch(setActionError)
                }
              />
            ))}
          </div>
          {a.signed && (
            <>
              <h2 style={{ marginTop: 18 }}>Signed</h2>
              <dl className="kv">
                <dt>Signed</dt>
                <dd>{formatDate(a.signed.signedAt, true)} (paper)</dd>
                <dt>Explained in</dt>
                <dd>
                  {DRIVER_LANGUAGE_LABELS[a.signed.explainedInLanguage]} by{' '}
                  {a.signed.explainedByName}
                </dd>
                {a.signed.stamp && (
                  <>
                    <dt>Stamp paper</dt>
                    <dd>
                      No. {a.signed.stamp.number}, {formatRupees(a.signed.stamp.value)}, bought{' '}
                      {formatDate(a.signed.stamp.purchasedOn)}
                    </dd>
                  </>
                )}
                <dt>Signed copy</dt>
                <dd>
                  <button
                    className="link"
                    onClick={() =>
                      void openLink(() =>
                        api.post<{ url: string }>(`/v1/agreements/${a.id}/signed-copy/link`),
                      ).catch(setActionError)
                    }
                  >
                    {a.signed.fileName}
                  </button>
                </dd>
              </dl>
            </>
          )}
        </div>
      </div>

      {a.installation && (
        <div className="card">
          <h2>Installation (Schedule 3)</h2>
          {a.installation.status === 'PENDING_VERIFICATION' && (
            <div className="alert warn">
              Recorded by {a.installation.recordedByName ?? 'field staff'}. Waiting for head office
              to verify it: check the photos and readings. The agreement starts only once it is
              verified.
              {a.allowed.verifyInstallation && can('installations.verify') && (
                <div className="row" style={{ marginTop: 10 }}>
                  <button
                    className="primary"
                    onClick={() =>
                      void act(
                        () =>
                          api.post<AgreementDetail>(
                            `/v1/agreements/${a.id}/installation/${a.installation!.id}/verify`,
                          ),
                        'Installation verified. The agreement is active.',
                      )
                    }
                  >
                    Verify installation
                  </button>
                  <button
                    className="danger"
                    onClick={() => {
                      const reason = window.prompt(
                        'What is wrong? The installer will see this and record it again.',
                      );
                      if (!reason || reason.trim().length < 5) return;
                      void act(
                        () =>
                          api.post<AgreementDetail>(
                            `/v1/agreements/${a.id}/installation/${a.installation!.id}/reject`,
                            { reason: reason.trim() },
                          ),
                        'Installation sent back to be recorded again.',
                      );
                    }}
                  >
                    Reject
                  </button>
                </div>
              )}
            </div>
          )}
          {a.installation.status === 'REJECTED' && (
            <div className="alert danger">
              Rejected by {a.installation.decidedByName ?? 'head office'}
              {a.installation.decidedAt &&
                ` on ${formatDate(a.installation.decidedAt, true)}`}:{' '}
              {a.installation.rejectedReason}. It must be recorded again.
            </div>
          )}
          <dl className="kv">
            <dt>Installed</dt>
            <dd>
              {formatDate(a.installation.installedAt, true)} at {a.installation.location}
              {a.installation.geotag && (
                <>
                  {' · '}
                  <a href={mapLink(a.installation.geotag)} target="_blank" rel="noreferrer">
                    Location on map
                  </a>
                  {a.installation.geotag.accuracyM !== null && (
                    <span className="muted">
                      {' '}
                      (±{Math.round(a.installation.geotag.accuracyM)} m)
                    </span>
                  )}
                </>
              )}
            </dd>
            <dt>Installed by</dt>
            <dd>{a.installation.technicianName}</dd>
            <dt>Recorded by</dt>
            <dd>{a.installation.recordedByName}</dd>
            {a.installation.status === 'VERIFIED' &&
              a.installation.decidedByName &&
              a.installation.decidedByName !== a.installation.recordedByName && (
                <>
                  <dt>Verified by</dt>
                  <dd>
                    {a.installation.decidedByName}
                    {a.installation.decidedAt && `, ${formatDate(a.installation.decidedAt, true)}`}
                  </dd>
                </>
              )}
            <dt>Voltage reading</dt>
            <dd>{a.installation.voltageReading} V</dd>
            {a.installation.readingsNote && (
              <>
                <dt>Other readings</dt>
                <dd>{a.installation.readingsNote}</dd>
              </>
            )}
            <dt>Condition</dt>
            <dd>{a.installation.conditionNote}</dd>
            <dt>Driver confirmed</dt>
            <dd>{a.installation.driverConfirmed ? 'Yes' : 'No'}</dd>
            <dt>Photos</dt>
            <dd>
              {a.installation.photos.map((p, i) => (
                <span key={p.id}>
                  {i > 0 && ' · '}
                  <button
                    className="link"
                    onClick={() =>
                      void openLink(() =>
                        api.post<{ url: string }>(
                          `/v1/agreements/${a.id}/installation/photos/${p.id}/link`,
                        ),
                      ).catch(setActionError)
                    }
                  >
                    {p.fileName}
                  </button>
                </span>
              ))}
            </dd>
          </dl>
        </div>
      )}

      {a.allowed.pay && (
        <PaymentLinksCard
          agreementId={a.id}
          canSend={a.allowed.pay}
          max={nextAmount}
          suggested={Math.min(
            nextAmount,
            a.state === 'AWAITING_DOWN_PAYMENT'
              ? nextAmount
              : (a.money.nextDue?.amountLeft ?? 0) + a.money.lateFeesDue,
          )}
          onPaid={() => {
            void reload();
            void payments.reload();
          }}
        />
      )}

      {a.state !== 'DRAFT' && a.state !== 'CANCELLED' && (
        <AutopayCard agreementId={a.id} onChange={() => void reload()} />
      )}

      {payments.data && (
        <div className="card table-wrap" style={{ padding: 0 }}>
          <h2 style={{ padding: '16px 16px 0' }}>Payments</h2>
          <table>
            <thead>
              <tr>
                <th>Receipt</th>
                <th>Received</th>
                <th className="num">Amount</th>
                <th>Paid towards</th>
                <th>By</th>
                <th>Receipt SMS</th>
              </tr>
            </thead>
            <tbody>
              {payments.data.items.length === 0 && (
                <tr>
                  <td colSpan={6} className="empty">
                    No payments yet.
                  </td>
                </tr>
              )}
              {payments.data.items.map((p) => (
                <tr key={p.id}>
                  <td>
                    <button
                      className="link mono nowrap"
                      onClick={() =>
                        void openBlob(() => api.blob(`/v1/payments/${p.id}/receipt`)).catch(
                          setActionError,
                        )
                      }
                    >
                      {p.receiptNumber}
                    </button>
                  </td>
                  <td>{formatDate(p.receivedAt, true)}</td>
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
                    {p.source === 'GATEWAY' ? ' (gateway)' : ''}
                    {p.collectedByName && ` · ${p.collectedByName}`}
                    {p.reference && <div className="mono muted">{p.reference}</div>}
                  </td>
                  <td>
                    <MessageStatus messages={p.messages} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card table-wrap" style={{ padding: 0 }}>
        <h2 style={{ padding: '16px 16px 0' }}>
          Payment table {a.state === 'DRAFT' && <span className="muted">(preview)</span>}
        </h2>
        <table>
          <thead>
            <tr>
              <th>No.</th>
              <th>Due</th>
              <th className="num">Amount</th>
              <th className="num">Paid</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {a.schedule.map((l) => (
              <tr key={l.sequence} className={l.status === 'PAID' ? 'paid' : undefined}>
                <td>{l.sequence === 0 ? 'Down payment' : l.sequence}</td>
                <td>{l.dueDate ? formatDate(l.dueDate) : 'Before installation'}</td>
                <td className="num">
                  <Money paise={l.amount} />
                </td>
                <td className="num">
                  <Money paise={l.amountPaid} />
                </td>
                <td>
                  <span
                    className={`badge ${l.status === 'PAID' ? 'active' : l.status === 'PART_PAID' ? 'warn' : ''}`}
                  >
                    {l.status === 'PAID'
                      ? 'Paid'
                      : l.status === 'PART_PAID'
                        ? 'Part paid'
                        : 'Unpaid'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>History</h2>
        <ul className="timeline">
          {a.events
            .slice()
            .reverse()
            .map((e) => (
              <li key={e.id}>
                <strong>{e.event.replace(/_/g, ' ').toLowerCase()}</strong>{' '}
                <AgreementStateBadge state={e.toState} />
                <div className="muted" style={{ fontSize: 13 }}>
                  {formatDate(e.at, true)} ·{' '}
                  {e.actorName ?? (e.actorType === 'SYSTEM' ? 'System' : '—')}
                  {e.reason && ` · ${e.reason}`}
                </div>
              </li>
            ))}
        </ul>
      </div>

      <Modal open={dialog === 'pay'} onClose={() => setDialog('none')} title="Record payment" wide>
        <PaymentForm
          agreementId={a.id}
          maxHint={nextAmount}
          staff={staff}
          onDone={(p) => {
            void act(
              () => api.get<AgreementDetail>(`/v1/agreements/${a.id}`),
              `Receipt ${p.receiptNumber} issued for ${formatRupees(p.amount)}.${p.messages.at(-1)?.status === 'FAILED' ? ' The SMS could not be sent; resend it from Payments.' : ''}`,
            );
          }}
        />
      </Modal>

      <Modal
        open={dialog === 'sign'}
        onClose={() => setDialog('none')}
        title="Record the signature"
      >
        <SignForm
          a={a}
          staff={staff}
          meId={me?.id ?? ''}
          busy={busy}
          error={actionError}
          onSubmit={(form) =>
            act(
              () => api.upload<AgreementDetail>(`/v1/agreements/${a.id}/sign`, form),
              'Signed. The payment table is fixed; collect the down payment next.',
            )
          }
        />
      </Modal>

      <Modal
        open={dialog === 'install'}
        onClose={() => setDialog('none')}
        title="Record installation"
        wide
      >
        <InstallForm
          a={a}
          staff={staff}
          busy={busy}
          error={actionError}
          onSubmit={(form) =>
            act(
              () => api.upload<AgreementDetail>(`/v1/agreements/${a.id}/installation`, form),
              'Installed. The agreement is active.',
            )
          }
        />
      </Modal>

      <Modal
        open={dialog === 'battery'}
        onClose={() => setDialog('none')}
        title="Change the battery"
        wide
      >
        <BatteryChangeForm
          a={a}
          busy={busy}
          error={actionError}
          onSubmit={(body) =>
            act(
              () => api.post<AgreementDetail>(`/v1/agreements/${a.id}/battery`, body),
              a.state === 'DRAFT'
                ? 'Battery changed. Print the agreement again before signing.'
                : 'Battery changed. The driver must sign the corrected agreement before installation.',
            )
          }
        />
      </Modal>

      <Modal
        open={dialog === 'resign'}
        onClose={() => setDialog('none')}
        title="Record the corrected agreement"
      >
        <ResignForm
          busy={busy}
          error={actionError}
          onSubmit={(form) =>
            act(
              () => api.upload<AgreementDetail>(`/v1/agreements/${a.id}/resign`, form),
              'Corrected agreement recorded. The battery can be installed.',
            )
          }
        />
      </Modal>

      <Modal open={dialog === 'edit'} onClose={() => setDialog('none')} title="Edit draft" wide>
        <EditForm
          a={a}
          busy={busy}
          error={actionError}
          onSubmit={(body) =>
            act(() => api.patch<AgreementDetail>(`/v1/agreements/${a.id}`, body), 'Draft saved.')
          }
        />
      </Modal>

      <Modal
        open={dialog === 'reschedule'}
        onClose={() => setDialog('none')}
        title="Move the first due date"
      >
        <RescheduleForm
          a={a}
          busy={busy}
          error={actionError}
          onSubmit={(body) =>
            act(async () => {
              await api.post(`/v1/agreements/${a.id}/reschedule`, body);
            }, 'Sent for approval. A second head-office person must approve it (clause A6).')
          }
        />
      </Modal>

      <Modal open={dialog === 'cancel'} onClose={() => setDialog('none')} title="Cancel agreement">
        <ReasonForm
          busy={busy}
          error={actionError}
          label="Why is it being cancelled?"
          action="Cancel agreement"
          onSubmit={(reason) =>
            act(
              () => api.post<AgreementDetail>(`/v1/agreements/${a.id}/cancel`, { reason }),
              'Cancelled.',
            )
          }
        />
      </Modal>
    </>
  );
}

function DocRow({ label, onOpen }: { label: string; onOpen: (lang: Lang) => void }) {
  return (
    <>
      <span>{label}</span>
      {LANGS.map((l) => (
        <button key={l} onClick={() => onOpen(l)} title={DRIVER_LANGUAGE_LABELS[l]}>
          {l === 'BN' ? 'বাংলা' : l === 'HI' ? 'हिंदी' : 'English'}
        </button>
      ))}
    </>
  );
}

function SignForm({
  a,
  staff,
  meId,
  busy,
  error,
  onSubmit,
}: {
  a: AgreementDetail;
  staff: StaffDirectoryRow[];
  meId: string;
  busy: boolean;
  error: unknown;
  onSubmit: (form: FormData) => void;
}) {
  const file = useRef<HTMLInputElement>(null);
  const [pickedFiles, setPickedFiles] = useState<File[]>([]);
  const [stampNumber, setStampNumber] = useState('');
  const [stampValue, setStampValue] = useState('');
  const [stampDate, setStampDate] = useState('');
  const [signedAt, setSignedAt] = useState(nowLocal());
  const [language, setLanguage] = useState<Lang>(a.language);
  const [explainedBy, setExplainedBy] = useState(meId);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!pickedFiles.length) return;
        const form = new FormData();
        form.set('signedAt', localToIso(signedAt));
        form.set('explainedInLanguage', language);
        form.set('explainedById', explainedBy);
        form.set('stampPaperNumber', stampNumber.trim());
        form.set('stampValueRupees', stampValue);
        form.set('stampPurchasedOn', stampDate);
        for (const f of pickedFiles) form.append('files', f);
        onSubmit(form);
      }}
    >
      <p className="muted">
        Upload the whole signed agreement, initialled on every page and signed by both parties and
        two witnesses, with the signed Key Facts (Schedule 5). Signing fixes the payment table; the
        terms, the signed copy and the stamp paper details cannot change afterwards.
      </p>
      <div className="field">
        <label htmlFor="sign-file">
          Signed copy: one scanned PDF (up to 25 MB) or photos of every page
        </label>
        <input
          id="sign-file"
          ref={file}
          type="file"
          accept="application/pdf,image/jpeg,image/png"
          multiple
          required
          onChange={(e) => setPickedFiles(Array.from(e.target.files ?? []))}
        />
        {pickedFiles.length > 1 && (
          <small className="muted">
            {pickedFiles.length} photos, joined into one PDF in this order:{' '}
            {pickedFiles.map((f) => f.name).join(', ')}
          </small>
        )}
      </div>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="stamp-no">Stamp paper number</label>
          <input
            id="stamp-no"
            required
            minLength={3}
            maxLength={60}
            placeholder="Serial or e-stamp certificate number"
            value={stampNumber}
            onChange={(e) => setStampNumber(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="stamp-value">Stamp value (₹)</label>
          <input
            id="stamp-value"
            type="number"
            required
            min={1}
            step={1}
            value={stampValue}
            onChange={(e) => setStampValue(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="stamp-date">Stamp paper bought on</label>
          <input
            id="stamp-date"
            type="date"
            required
            max={signedAt.slice(0, 10)}
            value={stampDate}
            onChange={(e) => setStampDate(e.target.value)}
          />
        </div>
      </div>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="sign-at">Signed at</label>
          <input
            id="sign-at"
            type="datetime-local"
            required
            value={signedAt}
            max={nowLocal()}
            onChange={(e) => setSignedAt(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="sign-lang">Explained in</label>
          <select
            id="sign-lang"
            value={language}
            onChange={(e) => setLanguage(e.target.value as Lang)}
          >
            {LANGS.map((l) => (
              <option key={l} value={l}>
                {DRIVER_LANGUAGE_LABELS[l]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="sign-by">Explained by</label>
          <select id="sign-by" value={explainedBy} onChange={(e) => setExplainedBy(e.target.value)}>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.id === meId ? ' (you)' : ''}
              </option>
            ))}
          </select>
        </div>
      </div>
      <ErrorBox error={error} />
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button type="submit" className="primary" disabled={busy}>
          {busy ? 'Saving…' : 'Record signature'}
        </button>
      </div>
    </form>
  );
}

function InstallForm({
  a,
  staff,
  busy,
  error,
  onSubmit,
}: {
  a: AgreementDetail;
  staff: StaffDirectoryRow[];
  busy: boolean;
  error: unknown;
  onSubmit: (form: FormData) => void;
}) {
  const technicians = staff.filter((s) => hasPermission(s.role, 'installations.record'));
  const photos = useRef<HTMLInputElement>(null);
  const [technicianId, setTechnicianId] = useState('');
  const [installedAt, setInstalledAt] = useState(nowLocal());
  const [location, setLocation] = useState('');
  const [voltage, setVoltage] = useState('');
  const [readings, setReadings] = useState('');
  const [condition, setCondition] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const files = photos.current?.files;
        if (!files?.length) return;
        const form = new FormData();
        form.set('technicianId', technicianId);
        form.set('installedAt', localToIso(installedAt));
        form.set('location', location);
        form.set('voltageReading', voltage);
        if (readings) form.set('readingsNote', readings);
        form.set('conditionNote', condition);
        form.set('driverConfirmed', String(confirmed));
        for (const f of Array.from(files).slice(0, 6)) form.append('photos', f);
        onSubmit(form);
      }}
    >
      <p className="muted">
        The technician&apos;s record for Schedule 3. Fit the battery assigned in the agreement:{' '}
        <strong className="mono">{a.battery?.serial}</strong>, IMEI{' '}
        <span className="mono">{a.battery?.gpsDeviceId}</span>. Check the serial number on the
        battery before fitting it.
      </p>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="inst-tech">Technician</label>
          <select
            id="inst-tech"
            required
            value={technicianId}
            onChange={(e) => setTechnicianId(e.target.value)}
          >
            <option value="">Choose</option>
            {technicians.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} · {ROLE_LABELS[s.role]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="inst-at">Installed at</label>
          <input
            id="inst-at"
            type="datetime-local"
            required
            value={installedAt}
            max={nowLocal()}
            onChange={(e) => setInstalledAt(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="inst-loc">Place</label>
          <input
            id="inst-loc"
            required
            minLength={3}
            value={location}
            onChange={(e) => setLocation(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="inst-v">Voltage reading (V)</label>
          <input
            id="inst-v"
            required
            inputMode="decimal"
            value={voltage}
            onChange={(e) => setVoltage(e.target.value.replace(/[^\d.]/g, ''))}
          />
        </div>
        <div className="field">
          <label htmlFor="inst-r">Other readings (optional)</label>
          <input id="inst-r" value={readings} onChange={(e) => setReadings(e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label htmlFor="inst-c">Condition of battery and wiring</label>
        <input
          id="inst-c"
          required
          minLength={3}
          value={condition}
          onChange={(e) => setCondition(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="inst-p">Photos (1 to 6)</label>
        <input id="inst-p" ref={photos} type="file" accept="image/*" multiple required />
      </div>
      <label className="check">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
        />
        The driver has checked and confirms this record
      </label>
      <ErrorBox error={error} />
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button type="submit" className="primary" disabled={busy || !confirmed}>
          {busy ? 'Saving…' : 'Record installation'}
        </button>
      </div>
    </form>
  );
}

function EditForm({
  a,
  busy,
  error,
  onSubmit,
}: {
  a: AgreementDetail;
  busy: boolean;
  error: unknown;
  onSubmit: (body: Record<string, unknown>) => void;
}) {
  const [dueDay, setDueDay] = useState<DueDay>(a.terms.dueDay as DueDay);
  const [firstDueDate, setFirstDueDate] = useState(a.terms.firstDueDate);
  const [notes, setNotes] = useState(a.notes ?? '');
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ dueDay, firstDueDate, notes: notes || null });
      }}
    >
      <p className="muted">
        Saving also picks up the driver&apos;s current vehicle and the current prices of the
        approved plan. The plan is changed at the driver&apos;s final approval; the battery with
        Change battery.
      </p>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="e-day">Monthly due day</label>
          <select
            id="e-day"
            value={dueDay}
            onChange={(e) => {
              const d = Number(e.target.value) as DueDay;
              setDueDay(d);
              setFirstDueDate(suggestFirstDueDate(d, todayIst()));
            }}
          >
            <option value={2}>2nd</option>
            <option value={17}>17th</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="e-first">First due date</label>
          <input
            id="e-first"
            type="date"
            value={firstDueDate}
            onChange={(e) => setFirstDueDate(e.target.value)}
          />
        </div>
      </div>
      <div className="field">
        <label htmlFor="e-notes">Notes</label>
        <input id="e-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <ErrorBox error={error} />
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button type="submit" className="primary" disabled={busy}>
          {busy ? 'Saving…' : 'Save draft'}
        </button>
      </div>
    </form>
  );
}

function RescheduleForm({
  a,
  busy,
  error,
  onSubmit,
}: {
  a: AgreementDetail;
  busy: boolean;
  error: unknown;
  onSubmit: (body: { firstDueDate: string; reason: string }) => void;
}) {
  const [firstDueDate, setFirstDueDate] = useState(
    suggestFirstDueDate(a.terms.dueDay as DueDay, todayIst()),
  );
  const [reason, setReason] = useState('');
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ firstDueDate, reason });
      }}
    >
      <p className="muted">
        Currently {formatDate(a.terms.firstDueDate)}. Every instalment moves by the same number of
        months. The driver should sign a new Schedule 1.
      </p>
      <div className="field">
        <label htmlFor="r-date">New first due date (the {ordinal(a.terms.dueDay)})</label>
        <input
          id="r-date"
          type="date"
          required
          value={firstDueDate}
          onChange={(e) => setFirstDueDate(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="r-reason">Reason</label>
        <input
          id="r-reason"
          required
          minLength={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>
      <ErrorBox error={error} />
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button type="submit" className="primary" disabled={busy}>
          Send for approval
        </button>
      </div>
    </form>
  );
}

function ReasonForm({
  busy,
  error,
  label,
  action,
  onSubmit,
}: {
  busy: boolean;
  error: unknown;
  label: string;
  action: string;
  onSubmit: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(reason);
      }}
    >
      <div className="field">
        <label htmlFor="reason">{label}</label>
        <input
          id="reason"
          required
          minLength={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>
      <ErrorBox error={error} />
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button type="submit" className="danger" disabled={busy}>
          {action}
        </button>
      </div>
    </form>
  );
}

/** Founder, 1 Nov 2026: the assigned battery can change until it is installed. */
function BatteryChangeForm({
  a,
  busy,
  error,
  onSubmit,
}: {
  a: AgreementDetail;
  busy: boolean;
  error: unknown;
  onSubmit: (body: { batteryId: string; reason: string }) => void;
}) {
  const { api } = useSession();
  const signed = a.state !== 'DRAFT';
  const stock = useLoad(
    () =>
      api.get<Paged<BatteryRow>>(
        `/v1/batteries?${new URLSearchParams({
          available: 'true',
          limit: '200',
          ...(signed ? { batteryTypeId: a.batteryType.id } : {}),
        })}`,
      ),
    [api, signed, a.batteryType.id],
  );
  const [batteryId, setBatteryId] = useState('');
  const [reason, setReason] = useState('');
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ batteryId, reason });
      }}
    >
      <p className="muted">
        {signed
          ? `The agreement is signed, so the new battery must be a ${a.batteryType.name} (same price). The driver then signs the corrected agreement before installation.`
          : 'The draft is reprinted with the new battery; if its type differs, the figures follow the plan price for that type.'}
      </p>
      <ErrorBox error={stock.error} />
      <div className="field">
        <label htmlFor="cb-battery">New battery</label>
        <select
          id="cb-battery"
          required
          value={batteryId}
          onChange={(e) => setBatteryId(e.target.value)}
        >
          <option value="">
            {stock.data?.items.length ? 'Choose a battery' : 'No suitable battery in stock'}
          </option>
          {stock.data?.items.map((b) => (
            <option key={b.id} value={b.id}>
              {b.serial} · IMEI {b.gpsDeviceId} · {b.batteryType.name}
              {b.location ? ` · ${b.location}` : ''}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="cb-reason">Why</label>
        <input
          id="cb-reason"
          required
          minLength={5}
          maxLength={300}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>
      <ErrorBox error={error} />
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button type="submit" className="primary" disabled={busy || !batteryId}>
          {busy ? 'Saving…' : 'Change battery'}
        </button>
      </div>
    </form>
  );
}

/** The corrected agreement the driver signed after the battery changed. */
function ResignForm({
  busy,
  error,
  onSubmit,
}: {
  busy: boolean;
  error: unknown;
  onSubmit: (form: FormData) => void;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [signedAt, setSignedAt] = useState(nowLocal());
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!files.length) return;
        const form = new FormData();
        form.set('signedAt', localToIso(signedAt));
        for (const f of files) form.append('files', f);
        onSubmit(form);
      }}
    >
      <div className="field">
        <label htmlFor="rs-at">Signed at</label>
        <input
          id="rs-at"
          type="datetime-local"
          required
          value={signedAt}
          max={nowLocal()}
          onChange={(e) => setSignedAt(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="rs-file">Scan (one PDF) or photos of every page</label>
        <input
          id="rs-file"
          type="file"
          accept="application/pdf,image/jpeg,image/png"
          multiple
          required
          onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
        />
      </div>
      <ErrorBox error={error} />
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button type="submit" className="primary" disabled={busy || !files.length}>
          {busy ? 'Saving…' : 'Record corrected agreement'}
        </button>
      </div>
    </form>
  );
}

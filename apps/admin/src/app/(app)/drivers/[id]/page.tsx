'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useRef, useState } from 'react';
import {
  DRIVER_LANGUAGE_LABELS,
  KYC_DOC_INFO,
  KYC_DOC_TYPES,
  READINESS_LABELS,
  VEHICLE_TYPE_LABELS,
  type KycDocType,
  type ReadinessItem,
  type VehicleType,
  RELATIVE_RELATION_LABELS,
} from '@voltneo/shared';
import { useSession } from '@/lib/session';
import type { AgreementListRow, DriverDetail, KycDoc, Paged } from '@/lib/types';
import { AgreementStateBadge } from '@/components/AgreementBits';
import {
  DriverFields,
  VehicleFields,
  driverDraft,
  driverPayload,
  vehicleDraft,
  vehiclePayload,
} from '@/components/DriverForms';
import {
  DuplicateWarning,
  ErrorBox,
  Modal,
  Money,
  StatusBadge,
  duplicatesOf,
  formatDate,
  useLoad,
  type DuplicateMatch,
} from '@/components/ui';

type Dialog = 'none' | 'edit' | 'vehicle' | 'upload' | 'reject';

/** Opens a short-lived file link in a new tab without tripping pop-up blockers. */
async function openLink(get: () => Promise<{ url: string }>) {
  const w = window.open('', '_blank');
  try {
    const { url } = await get();
    if (w) w.location.href = url;
    else window.location.href = url;
  } catch (err) {
    w?.close();
    throw err;
  }
}

export default function DriverPage() {
  const { id } = useParams<{ id: string }>();
  const { api, can } = useSession();
  const {
    data: d,
    error,
    setData,
  } = useLoad(() => api.get<DriverDetail>(`/v1/drivers/${id}`), [api, id]);
  const [dialog, setDialog] = useState<Dialog>('none');
  const [draft, setDraft] = useState(driverDraft());
  const [vehicle, setVehicle] = useState(vehicleDraft());
  const [docType, setDocType] = useState<KycDocType>('VOTER_ID');
  const [docNumber, setDocNumber] = useState('');
  const [forAddress, setForAddress] = useState(false);
  const [rejecting, setRejecting] = useState<KycDoc | null>(null);
  const [reason, setReason] = useState('');
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [dups, setDups] = useState<DuplicateMatch[] | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const consentRef = useRef<HTMLInputElement>(null);

  const manage = can('drivers.manage');
  const verify = can('kyc.verify');
  const viewFull = can('kyc.view_full');

  async function act(fn: () => Promise<DriverDetail | void>, done?: string, close = true) {
    setBusy(true);
    setActionError(null);
    setMessage(null);
    try {
      const res = await fn();
      if (res) setData(res);
      if (close) setDialog('none');
      setDups(null);
      if (done) setMessage(done);
    } catch (err) {
      const dd = duplicatesOf(err);
      if (dd) setDups(dd);
      else setActionError(err);
    } finally {
      setBusy(false);
    }
  }

  function open(next: Dialog) {
    setActionError(null);
    setDups(null);
    setDialog(next);
  }

  if (!d) return <ErrorBox error={error} />;
  const info = KYC_DOC_INFO[docType];

  const upload = (acknowledge = false) => {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    const form = new FormData();
    form.set('type', docType);
    if (info.hasNumber) form.set('number', docNumber);
    if (forAddress) form.set('usedForAddress', 'true');
    if (acknowledge) form.set('acknowledgeDuplicates', 'true');
    form.set('file', file);
    void act(
      () => api.upload<DriverDetail>(`/v1/drivers/${id}/kyc`, form),
      `${info.label} uploaded. It needs checking before it counts.`,
    );
  };

  return (
    <>
      <Link href="/drivers" className="back">
        ← Drivers
      </Link>
      <div className="page-head">
        <div>
          <h1>
            {d.name} {d.status !== 'ACTIVE' && <StatusBadge status={d.status} />}
          </h1>
          <p className="muted">
            <span className="mono">{d.phone}</span> · {DRIVER_LANGUAGE_LABELS[d.language]} ·
            registered {formatDate(d.createdAt)}
          </p>
        </div>
        {manage && (
          <div className="row">
            <button
              onClick={() => {
                setDraft(driverDraft(d));
                open('edit');
              }}
            >
              Edit details
            </button>
            <button
              onClick={() =>
                void act(
                  () =>
                    api.patch<DriverDetail>(`/v1/drivers/${id}`, {
                      status: d.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE',
                    }),
                  d.status === 'ACTIVE' ? 'Marked inactive.' : 'Active again.',
                )
              }
              disabled={busy}
            >
              {d.status === 'ACTIVE' ? 'Mark inactive' : 'Make active'}
            </button>
          </div>
        )}
      </div>
      {message && <div className="alert success">{message}</div>}
      {dialog === 'none' && <ErrorBox error={actionError} />}
      {d.duplicates.length > 0 && (
        <div className="alert info">
          <strong>Possible duplicate.</strong>{' '}
          {d.duplicates.map((x, i) => (
            <span key={i}>
              {i > 0 && '; '}
              {x.detail}: <Link href={`/drivers/${x.driverId}`}>{x.driverName}</Link>
            </span>
          ))}
        </div>
      )}

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
        <div className="card">
          <h2>Ready for an agreement?</h2>
          <p>
            {d.readiness.ready ? (
              <span className="badge active">Ready</span>
            ) : (
              <span className="badge warn">Not yet</span>
            )}
          </p>
          <ul className="checklist">
            {d.readiness.items
              .filter((i) => i.applies)
              .map((i) => (
                <li key={i.item}>
                  <span className={`tick ${i.done ? 'done' : 'todo'}`}>{i.done ? '✓' : '✗'}</span>
                  {READINESS_LABELS[i.item as ReadinessItem]}
                </li>
              ))}
          </ul>
        </div>
        {can('agreements.read') && <DriverAgreements driverId={d.id} ready={d.readiness.ready} />}
        <div className="card">
          <h2>Details</h2>
          <dl className="kv">
            <dt>Date of birth</dt>
            <dd>{d.dateOfBirth ? formatDate(d.dateOfBirth) : '—'}</dd>
            <dt>Address</dt>
            <dd>
              {[d.addressLine, d.area, d.district, d.state].filter(Boolean).join(', ')} {d.pinCode}
            </dd>
            {d.altPhone && (
              <>
                <dt>Other number</dt>
                <dd className="mono">{d.altPhone}</dd>
              </>
            )}
            <dt>Son / daughter / wife of</dt>
            <dd>
              {d.relative ? (
                `${RELATIVE_RELATION_LABELS[d.relative.relation]} ${d.relative.name}`
              ) : (
                <span className="muted">Not recorded: written by hand on the agreement</span>
              )}
            </dd>
            <dt>Nominee</dt>
            <dd>
              {d.nominee.name ? (
                <>
                  {d.nominee.name} ({d.nominee.relation}){' '}
                  <span className="mono">{d.nominee.phone}</span>
                </>
              ) : (
                <span className="muted">Not recorded</span>
              )}
            </dd>
            {d.notes && (
              <>
                <dt>Notes</dt>
                <dd>{d.notes}</dd>
              </>
            )}
          </dl>
        </div>
      </div>

      <div className="section">
        <h2>
          KYC documents
          {manage && (
            <button
              className="primary"
              onClick={() => {
                setDocType('VOTER_ID');
                setDocNumber('');
                setForAddress(false);
                open('upload');
              }}
            >
              Add document
            </button>
          )}
        </h2>
        <div className="card table-wrap" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Document</th>
                <th>Number</th>
                <th>Status</th>
                <th>Added</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {d.documents.length === 0 && (
                <tr>
                  <td colSpan={5} className="empty">
                    No documents yet.
                  </td>
                </tr>
              )}
              {d.documents.map((k) => (
                <tr key={k.id}>
                  <td>
                    {k.label}
                    {k.usedForAddress && (
                      <div className="muted" style={{ fontSize: 13 }}>
                        Proof of address
                      </div>
                    )}
                  </td>
                  <td className="mono">
                    {revealed[k.id] ?? k.maskedNumber ?? '—'}
                    {viewFull && k.fullNumberStored && !revealed[k.id] && (
                      <div>
                        <button
                          className="link"
                          style={{ fontSize: 13 }}
                          onClick={() =>
                            void act(async () => {
                              const r = await api.post<{ number: string }>(
                                `/v1/kyc-documents/${k.id}/reveal`,
                              );
                              setRevealed({ ...revealed, [k.id]: r.number });
                            })
                          }
                        >
                          Show full number
                        </button>
                      </div>
                    )}
                  </td>
                  <td>
                    <StatusBadge status={k.status} />
                    {k.verifiedByName && (
                      <div className="muted" style={{ fontSize: 13 }}>
                        by {k.verifiedByName}, {formatDate(k.verifiedAt)}
                      </div>
                    )}
                    {k.rejectionReason && (
                      <div className="muted" style={{ fontSize: 13 }}>
                        “{k.rejectionReason}”
                      </div>
                    )}
                  </td>
                  <td className="muted">
                    {formatDate(k.createdAt)}
                    <div style={{ fontSize: 13 }}>{k.uploadedByName}</div>
                  </td>
                  <td>
                    <div className="row" style={{ justifyContent: 'flex-end' }}>
                      {viewFull && (
                        <button
                          onClick={() =>
                            void act(() =>
                              openLink(() => api.post(`/v1/kyc-documents/${k.id}/link`)),
                            )
                          }
                        >
                          View
                        </button>
                      )}
                      {verify && k.status === 'PENDING' && (
                        <button
                          className="primary"
                          disabled={busy}
                          onClick={() =>
                            void act(
                              () => api.post<DriverDetail>(`/v1/kyc-documents/${k.id}/verify`),
                              `${k.label} verified.`,
                            )
                          }
                        >
                          Verify
                        </button>
                      )}
                      {verify && k.status !== 'REJECTED' && (
                        <button
                          className="danger"
                          onClick={() => {
                            setRejecting(k);
                            setReason('');
                            open('reject');
                          }}
                        >
                          Reject
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {viewFull && (
          <p className="muted" style={{ fontSize: 13 }}>
            Every document view and full-number reveal is recorded in the audit log.
          </p>
        )}
      </div>

      <div className="section">
        <h2>
          Vehicle
          {manage && (
            <button
              onClick={() => {
                setVehicle(vehicleDraft(d.vehicle));
                open('vehicle');
              }}
            >
              {d.vehicle ? 'Change vehicle' : 'Record vehicle'}
            </button>
          )}
        </h2>
        <div className="card">
          {d.vehicle ? (
            <dl className="kv">
              <dt>Vehicle</dt>
              <dd>
                {VEHICLE_TYPE_LABELS[d.vehicle.type as VehicleType]}
                {d.vehicle.makeModel && ` · ${d.vehicle.makeModel}`}
              </dd>
              <dt>Registration</dt>
              <dd className="mono">{d.vehicle.registration ?? 'None'}</dd>
              {d.vehicle.chassisNumber && (
                <>
                  <dt>Chassis</dt>
                  <dd className="mono">{d.vehicle.chassisNumber}</dd>
                </>
              )}
              <dt>Owner</dt>
              <dd>
                {d.vehicle.ownedByDriver ? (
                  'The driver'
                ) : (
                  <>
                    {d.vehicle.ownerName} <span className="mono">{d.vehicle.ownerPhone}</span>{' '}
                    (driver rents it)
                  </>
                )}
              </dd>
              {!d.vehicle.ownedByDriver && (
                <>
                  <dt>Owner&apos;s consent</dt>
                  <dd>
                    {d.vehicle.ownerConsent ? (
                      <>
                        Uploaded {formatDate(d.vehicle.ownerConsent.uploadedAt)}{' '}
                        {viewFull && (
                          <button
                            className="link"
                            onClick={() =>
                              void act(() =>
                                openLink(() =>
                                  api.post(`/v1/drivers/${id}/vehicle/owner-consent/link`),
                                ),
                              )
                            }
                          >
                            View
                          </button>
                        )}
                      </>
                    ) : (
                      <span className="below">Not uploaded</span>
                    )}
                    {manage && (
                      <div style={{ marginTop: 6 }}>
                        <input
                          ref={consentRef}
                          type="file"
                          accept="image/jpeg,image/png,image/webp,application/pdf"
                          style={{ width: 'auto' }}
                          onChange={() => {
                            const f = consentRef.current?.files?.[0];
                            if (!f) return;
                            const form = new FormData();
                            form.set('file', f);
                            void act(
                              () =>
                                api.upload<DriverDetail>(
                                  `/v1/drivers/${id}/vehicle/owner-consent`,
                                  form,
                                ),
                              'Owner consent uploaded.',
                            );
                          }}
                        />
                        <div className="hint">
                          The signed consent form from the vehicle owner (photo or PDF).
                        </div>
                      </div>
                    )}
                  </dd>
                </>
              )}
            </dl>
          ) : (
            <p className="muted">No vehicle recorded.</p>
          )}
        </div>
      </div>

      <Modal open={dialog === 'edit'} onClose={() => setDialog('none')} title="Edit driver" wide>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void act(
              () => api.patch<DriverDetail>(`/v1/drivers/${id}`, driverPayload(draft)),
              'Saved.',
            );
          }}
        >
          <ErrorBox error={actionError} />
          <DriverFields value={draft} onChange={setDraft} />
          {dups && (
            <DuplicateWarning
              matches={dups}
              busy={busy}
              onConfirm={() =>
                void act(
                  () =>
                    api.patch<DriverDetail>(`/v1/drivers/${id}`, {
                      ...driverPayload(draft),
                      acknowledgeDuplicates: true,
                    }),
                  'Saved.',
                )
              }
            />
          )}
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button type="button" onClick={() => setDialog('none')}>
              Cancel
            </button>
            <button className="primary" type="submit" disabled={busy}>
              Save
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={dialog === 'vehicle'}
        onClose={() => setDialog('none')}
        title={d.vehicle ? 'Change vehicle' : 'Record vehicle'}
        wide
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void act(
              () => api.put<DriverDetail>(`/v1/drivers/${id}/vehicle`, vehiclePayload(vehicle)),
              'Vehicle saved.',
            );
          }}
        >
          <ErrorBox error={actionError} />
          {d.vehicle && (
            <p className="muted">The current vehicle is kept in the driver&apos;s history.</p>
          )}
          <VehicleFields value={vehicle} onChange={setVehicle} />
          {dups && (
            <DuplicateWarning
              matches={dups}
              busy={busy}
              onConfirm={() =>
                void act(
                  () =>
                    api.put<DriverDetail>(`/v1/drivers/${id}/vehicle`, {
                      ...vehiclePayload(vehicle),
                      acknowledgeDuplicates: true,
                    }),
                  'Vehicle saved.',
                )
              }
            />
          )}
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button type="button" onClick={() => setDialog('none')}>
              Cancel
            </button>
            <button className="primary" type="submit" disabled={busy}>
              Save
            </button>
          </div>
        </form>
      </Modal>

      <Modal open={dialog === 'upload'} onClose={() => setDialog('none')} title="Add KYC document">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setDups(null);
            upload();
          }}
        >
          <ErrorBox error={actionError} />
          <div className="field">
            <label htmlFor="k-type">Document</label>
            <select
              id="k-type"
              value={docType}
              onChange={(e) => {
                const t = e.target.value as KycDocType;
                setDocType(t);
                if (!KYC_DOC_INFO[t].canProveAddress) setForAddress(false);
              }}
            >
              {KYC_DOC_TYPES.map((t) => (
                <option key={t} value={t}>
                  {KYC_DOC_INFO[t].label}
                </option>
              ))}
            </select>
          </div>
          {info.hasNumber && (
            <div className="field">
              <label htmlFor="k-number">Number</label>
              <input
                id="k-number"
                required
                className="mono"
                autoComplete="off"
                value={docNumber}
                onChange={(e) => setDocNumber(e.target.value)}
              />
              <div className="hint">
                {info.formatHint ? `${info.formatHint}. ` : ''}
                {docType === 'AADHAAR'
                  ? 'Only the last 4 digits are kept. Upload a masked Aadhaar where possible.'
                  : 'Stored encrypted; shown masked.'}
              </div>
            </div>
          )}
          {info.canProveAddress && (
            <label className="checkbox" style={{ marginBottom: 12 }}>
              <input
                type="checkbox"
                checked={forAddress}
                onChange={(e) => setForAddress(e.target.checked)}
              />
              Use as proof of address
            </label>
          )}
          <div className="field">
            <label htmlFor="k-file">Photo or PDF (up to 10 MB)</label>
            <input
              id="k-file"
              ref={fileRef}
              type="file"
              required
              accept="image/jpeg,image/png,image/webp,application/pdf"
            />
          </div>
          {dups && <DuplicateWarning matches={dups} busy={busy} onConfirm={() => upload(true)} />}
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button type="button" onClick={() => setDialog('none')}>
              Cancel
            </button>
            <button className="primary" type="submit" disabled={busy}>
              {busy ? 'Uploading…' : 'Upload'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={dialog === 'reject'}
        onClose={() => setDialog('none')}
        title={`Reject ${rejecting?.label ?? 'document'}`}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void act(
              () => api.post<DriverDetail>(`/v1/kyc-documents/${rejecting!.id}/reject`, { reason }),
              'Document rejected.',
            );
          }}
        >
          <ErrorBox error={actionError} />
          <div className="field">
            <label htmlFor="k-reason">Reason</label>
            <input
              id="k-reason"
              required
              minLength={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Photo is blurred"
            />
          </div>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button type="button" onClick={() => setDialog('none')}>
              Cancel
            </button>
            <button className="primary" type="submit" disabled={busy || reason.trim().length < 3}>
              Reject
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}

function DriverAgreements({ driverId, ready }: { driverId: string; ready: boolean }) {
  const { api, can } = useSession();
  const list = useLoad(
    () => api.get<Paged<AgreementListRow>>(`/v1/agreements?driverId=${driverId}`),
    [api, driverId],
  );
  const open = list.data?.items.filter(
    (a) => !['CLOSED', 'TRANSFERRED', 'CANCELLED'].includes(a.state),
  );
  return (
    <div className="card">
      <h2>Agreements</h2>
      <ErrorBox error={list.error} />
      {list.data?.items.length === 0 && <p className="muted">None yet.</p>}
      <ul className="timeline">
        {list.data?.items.map((a) => (
          <li key={a.id}>
            <Link href={`/agreements/${a.id}`} className="mono">
              {a.number}
            </Link>{' '}
            <AgreementStateBadge state={a.state} />
            <div className="muted" style={{ fontSize: 13 }}>
              {a.planName} · still to pay <Money paise={a.outstanding} />
            </div>
          </li>
        ))}
      </ul>
      {can('agreements.manage') && open?.length === 0 && (
        <p style={{ marginTop: 10 }}>
          <Link href={`/agreements/new?driverId=${driverId}`} className="button">
            Start an agreement
          </Link>
          {!ready && (
            <span className="muted" style={{ fontSize: 13 }}>
              {' '}
              (a draft is possible; signing needs the checklist complete)
            </span>
          )}
        </p>
      )}
    </div>
  );
}

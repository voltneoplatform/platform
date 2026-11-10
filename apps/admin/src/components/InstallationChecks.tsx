'use client';

import { useState } from 'react';
import { INSTALLATION_ITEM_HINTS, maxInstallationPhotos } from '@voltneo/shared';
import { useSession } from '@/lib/session';
import type { AgreementDetail, InstallationPhotoRow } from '@/lib/types';
import { openLink } from '@/components/AgreementBits';
import { ErrorBox, Modal, StatusBadge, formatDate } from '@/components/ui';

const ITEM_STATUS: Record<string, { label: string; tone: string }> = {
  VERIFIED: { label: 'Verified', tone: 'active' },
  PENDING: { label: 'To check', tone: 'warn' },
  REJECTED: { label: 'New photo needed', tone: 'deactivated' },
  MISSING: { label: 'No photo', tone: '' },
};

/**
 * Founder, 10 Nov 2026: each installation photo is checked like a KYC
 * document (super admin, operations manager); then super admin, operations
 * manager or plan manager gives the final approval that starts the agreement.
 */
export function InstallationChecks({
  a,
  onChange,
}: {
  a: AgreementDetail;
  onChange: (next: AgreementDetail, done: string) => void;
}) {
  const { api, can } = useSession();
  const inst = a.installation!;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [rejecting, setRejecting] = useState<InstallationPhotoRow | null>(null);
  const [reason, setReason] = useState('');
  const [rejectingAll, setRejectingAll] = useState(false);
  const waiting = inst.status === 'PENDING_VERIFICATION' && a.allowed.verifyInstallation;
  const check = waiting && can('installations.verify');
  const approve = waiting && can('installations.approve');
  const addPhotos = waiting && can('installations.record');

  async function act(fn: () => Promise<AgreementDetail>, done: string) {
    setBusy(true);
    setError(null);
    try {
      onChange(await fn(), done);
      setRejecting(null);
      setRejectingAll(false);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  function upload(item: string, files: FileList | null) {
    if (!files?.length) return;
    const form = new FormData();
    form.set('item', item);
    for (const f of Array.from(files).slice(0, 4)) form.append('photos', f);
    void act(
      () =>
        api.upload<AgreementDetail>(`/v1/agreements/${a.id}/installation/${inst.id}/photos`, form),
      'Photo added. It waits to be checked.',
    );
  }

  return (
    <div>
      {waiting && (
        <div className="alert warn">
          Recorded by {inst.recordedByName ?? 'field staff'}. Check each photo, then give the final
          approval. The agreement starts only once approved.
        </div>
      )}
      <ErrorBox error={error} />
      <table>
        <thead>
          <tr>
            <th>Photo of</th>
            <th>Photos</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {inst.items
            .filter((i) => i.required || inst.photos.some((p) => p.item === i.item) || addPhotos)
            .map((i) => {
              const photos = inst.photos.filter((p) => p.item === i.item);
              const canAdd =
                addPhotos &&
                (i.item === 'OTHER' || i.status === 'REJECTED' || i.status === 'MISSING');
              return (
                <tr key={i.item}>
                  <td>
                    <strong>{i.label}</strong>
                    {!i.required && <span className="muted"> (optional)</span>}
                    <div className="muted" style={{ fontSize: 13 }}>
                      {INSTALLATION_ITEM_HINTS[i.item]}
                    </div>
                  </td>
                  <td>
                    {photos.length === 0 && <span className="muted">None</span>}
                    {photos.map((p) => (
                      <div key={p.id} style={{ marginBottom: 6 }}>
                        <button
                          className="link"
                          onClick={() =>
                            void openLink(() =>
                              api.post<{ url: string }>(
                                `/v1/agreements/${a.id}/installation/photos/${p.id}/link`,
                              ),
                            ).catch(setError)
                          }
                        >
                          {p.fileName}
                        </button>{' '}
                        <StatusBadge status={p.status} />
                        {p.checkedByName && (
                          <span className="muted" style={{ fontSize: 13 }}>
                            {' '}
                            by {p.checkedByName}
                            {p.checkedAt && `, ${formatDate(p.checkedAt, true)}`}
                          </span>
                        )}
                        {p.reason && (
                          <div className="muted" style={{ fontSize: 13 }}>
                            “{p.reason}”
                          </div>
                        )}
                        {check && p.status === 'PENDING' && (
                          <span className="row" style={{ marginTop: 4 }}>
                            <button
                              className="primary"
                              disabled={busy}
                              onClick={() =>
                                void act(
                                  () =>
                                    api.post<AgreementDetail>(
                                      `/v1/agreements/${a.id}/installation/photos/${p.id}/verify`,
                                    ),
                                  `${i.label} verified.`,
                                )
                              }
                            >
                              Verify
                            </button>
                            <button
                              className="danger"
                              disabled={busy}
                              onClick={() => {
                                setRejecting(p);
                                setReason('');
                              }}
                            >
                              Reject
                            </button>
                          </span>
                        )}
                      </div>
                    ))}
                    {canAdd && (
                      <label className="muted" style={{ fontSize: 13, display: 'block' }}>
                        {i.status === 'REJECTED' ? 'Add a new photo: ' : 'Add a photo: '}
                        <input
                          type="file"
                          accept="image/*"
                          multiple={maxInstallationPhotos(i.item) > 1}
                          disabled={busy}
                          onChange={(e) => {
                            upload(i.item, e.target.files);
                            e.target.value = '';
                          }}
                        />
                      </label>
                    )}
                  </td>
                  <td>
                    <span className={`badge ${ITEM_STATUS[i.status]!.tone}`}>
                      {ITEM_STATUS[i.status]!.label}
                    </span>
                  </td>
                </tr>
              );
            })}
        </tbody>
      </table>
      {approve && (
        <div className="row" style={{ marginTop: 12 }}>
          <button
            className="primary"
            disabled={busy || !inst.readyForApproval}
            title={inst.readyForApproval ? undefined : 'Check every photo first'}
            onClick={() =>
              void act(
                () =>
                  api.post<AgreementDetail>(
                    `/v1/agreements/${a.id}/installation/${inst.id}/approve`,
                  ),
                'Installation approved. The agreement is active.',
              )
            }
          >
            Approve installation
          </button>
          <button
            className="danger"
            disabled={busy}
            onClick={() => {
              setReason('');
              setRejectingAll(true);
            }}
          >
            Reject whole installation
          </button>
          {!inst.readyForApproval && (
            <span className="muted" style={{ fontSize: 13 }}>
              Every required photo must be verified, and none waiting, before approval.
            </span>
          )}
        </div>
      )}

      <Modal
        open={!!rejecting}
        onClose={() => setRejecting(null)}
        title={`Reject photo: ${rejecting ? inst.items.find((x) => x.item === rejecting.item)?.label : ''}`}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const p = rejecting!;
            void act(
              () =>
                api.post<AgreementDetail>(
                  `/v1/agreements/${a.id}/installation/photos/${p.id}/reject`,
                  { reason: reason.trim() },
                ),
              'Photo rejected. The installer is asked for a new one.',
            );
          }}
        >
          <ErrorBox error={error} />
          <div className="field">
            <label htmlFor="ip-reason">What is wrong? The installer sees this.</label>
            <input
              id="ip-reason"
              required
              minLength={3}
              maxLength={300}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button type="submit" className="danger" disabled={busy || reason.trim().length < 3}>
              Reject photo
            </button>
          </div>
        </form>
      </Modal>

      <Modal open={rejectingAll} onClose={() => setRejectingAll(false)} title="Reject installation">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void act(
              () =>
                api.post<AgreementDetail>(`/v1/agreements/${a.id}/installation/${inst.id}/reject`, {
                  reason: reason.trim(),
                }),
              'Installation sent back to be recorded again.',
            );
          }}
        >
          <p className="muted">
            Use this when the installation itself is wrong (wrong vehicle or battery). For a poor
            photo, reject just that photo instead.
          </p>
          <ErrorBox error={error} />
          <div className="field">
            <label htmlFor="ia-reason">What is wrong? The installer sees this.</label>
            <input
              id="ia-reason"
              required
              minLength={5}
              maxLength={300}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button type="submit" className="danger" disabled={busy || reason.trim().length < 5}>
              Reject installation
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

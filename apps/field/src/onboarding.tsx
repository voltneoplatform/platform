import { useState } from 'react';
import { View } from 'react-native';
import {
  REFERRER_KINDS,
  REGISTRATION_CONSENT,
  type DriverLanguage,
  type OnboardingStage,
  type ReferrerKind,
} from '@voltneo/shared';
import type { GeoState } from '@/location';
import { useSession } from '@/session';
import {
  Badge,
  Body,
  Button,
  C,
  Choice,
  ErrorNotice,
  Field,
  H2,
  Muted,
  Notice,
  useLoad,
} from '@/ui';

/** Where the phone's location stands; saving is blocked until it is found. */
export function LocationNotice({ state, onRetry }: { state: GeoState; onRetry: () => void }) {
  const { t } = useSession();
  if (state.status === 'ok') {
    return (
      <Notice tone="success">
        {t('locationOk', { m: String(Math.round(state.geo.accuracyM)) })}
      </Notice>
    );
  }
  if (state.status === 'locating') return <Notice>{t('locating')}</Notice>;
  const text =
    state.status === 'denied'
      ? t('locationDenied')
      : state.status === 'off'
        ? t('locationOff')
        : state.status === 'rough'
          ? t('locationRough', { m: String(Math.round(state.geo.accuracyM)) })
          : t('locationError');
  return (
    <View style={{ gap: 8 }}>
      <Notice tone="warn">{text}</Notice>
      <Button title={t('retry')} variant="secondary" onPress={onRetry} />
    </View>
  );
}

/**
 * The driver's code (founder, 1 Nov 2026): read the consent line to the
 * driver, send a code to their phone, and enter the code they read out.
 */
export function PhoneCheck({
  phone,
  language,
  name,
  checkId,
  onConfirmed,
}: {
  phone: string;
  language: DriverLanguage;
  name?: string;
  checkId: string | null;
  onConfirmed: (checkId: string | null) => void;
}) {
  const { t, api } = useSession();
  const [sent, setSent] = useState<{ checkId: string; phone: string } | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  if (checkId) return <Notice tone="success">✓ {t('phoneConfirmed')}</Notice>;
  return (
    <View
      style={{ gap: 10, borderTopWidth: 1, borderTopColor: C.border, paddingTop: 10 }}
      testID="phone-check"
    >
      <H2>{t('consentTitle')}</H2>
      <Muted>{t('consentRead')}</Muted>
      <Body style={{ fontStyle: 'italic' }}>{REGISTRATION_CONSENT[language]}</Body>
      <ErrorNotice error={error} />
      <Button
        testID="send-driver-code"
        title={sent ? t('sendNewCode') : t('sendDriverCode')}
        variant={sent ? 'secondary' : 'primary'}
        busy={busy && !sent}
        disabled={phone.replace(/\D/g, '').length < 10}
        onPress={() =>
          void (async () => {
            setBusy(true);
            setError(null);
            try {
              setSent(
                await api.post<{ checkId: string; phone: string }>('/v1/drivers/phone-codes', {
                  phone,
                  language,
                  name,
                }),
              );
              setCode('');
            } catch (err) {
              setError(err);
            } finally {
              setBusy(false);
            }
          })()
        }
      />
      {sent && (
        <>
          <Muted>{t('codeSentNote', { phone: sent.phone })}</Muted>
          <Field
            testID="driver-code"
            label={t('driverCode')}
            value={code}
            onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
            keyboardType="number-pad"
            maxLength={6}
          />
          <Button
            testID="confirm-driver-code"
            title={t('confirmCode')}
            busy={busy}
            disabled={code.length !== 6}
            onPress={() =>
              void (async () => {
                setBusy(true);
                setError(null);
                try {
                  await api.post('/v1/drivers/phone-codes/confirm', {
                    checkId: sent.checkId,
                    code,
                  });
                  onConfirmed(sent.checkId);
                } catch (err) {
                  setError(err);
                } finally {
                  setBusy(false);
                }
              })()
            }
          />
        </>
      )}
    </View>
  );
}

interface PlanRow {
  id: string;
  code: string;
  names: { bn: string; hi: string; en: string };
  status: string;
  published: { termMonths: number | null } | null;
}

/** Active plans with a published version, named in the app's language. */
export function PlanPicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (planId: string) => void;
}) {
  const { t, api, lang } = useSession();
  const plans = useLoad(
    () =>
      api
        .get<PlanRow[]>('/v1/plans')
        .then((rows) => rows.filter((p) => p.status === 'ACTIVE' && p.published)),
    [api],
  );
  const name = (p: PlanRow) =>
    lang === 'BN' ? p.names.bn : lang === 'HI' ? p.names.hi : p.names.en;
  return (
    <View style={{ gap: 6 }}>
      <ErrorNotice error={plans.error} />
      {plans.data?.length === 0 && <Muted>{t('noPlans')}</Muted>}
      {plans.data && plans.data.length > 0 && (
        <Choice
          label={t('plan')}
          value={value}
          onChange={onChange}
          options={plans.data.map((p) => ({
            value: p.id,
            label: p.published?.termMonths ? `${name(p)} · ${p.published.termMonths}m` : name(p),
          }))}
        />
      )}
      <Muted>{t('planNote')}</Muted>
    </View>
  );
}

/** The onboarding stage as a badge (driver list and driver page). */
export function StageBadge({
  stage,
  done,
  total,
}: {
  stage: Exclude<OnboardingStage, 'AGREEMENT'>;
  done: number;
  total: number;
}) {
  const { t } = useSession();
  switch (stage) {
    case 'PAPERWORK':
      return <Badge tone="warn" text={t('stagePaperwork', { done, total })} />;
    case 'AWAITING_APPROVAL':
      return <Badge tone="info" text={t('stageAwaiting')} />;
    case 'REJECTED':
      return <Badge tone="danger" text={t('stageRejected')} />;
    case 'APPROVED':
      return <Badge tone="success" text={t('stageApproved')} />;
  }
}

/** Founder, 7 Nov 2026: who referred a driver (another driver or an outside person). */
export interface ReferredBy {
  type: 'DRIVER' | 'REFERRER';
  id: string;
  code: string;
  name: string;
  phone: string;
  kind: string | null;
}

interface ReferralOption {
  type: 'DRIVER' | 'REFERRER';
  id: string;
  code: string;
  name: string;
  phone: string;
  detail: string;
}

export function referralPayload(r: ReferredBy | null) {
  return {
    referredByDriverId: r?.type === 'DRIVER' ? r.id : null,
    referredByReferrerId: r?.type === 'REFERRER' ? r.id : null,
  };
}

/** Find the referrer by name, mobile or ID, or add an outside referrer. */
export function ReferralPicker({
  value,
  onChange,
  excludeDriverId,
}: {
  value: ReferredBy | null;
  onChange: (r: ReferredBy | null) => void;
  excludeDriverId?: string;
}) {
  const { t, api, labels } = useSession();
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [kind, setKind] = useState<ReferrerKind>('MECHANIC');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const q = search.trim();
  const results = useLoad(
    () =>
      q.length >= 2
        ? api.get<{ items: ReferralOption[] }>(
            `/v1/referrals/search?search=${encodeURIComponent(q)}`,
          )
        : Promise.resolve({ items: [] as ReferralOption[] }),
    [api, q],
  );
  const who = (type: string, kindOrDetail: string | null) =>
    type === 'DRIVER'
      ? t('voltNeoDriver')
      : (labels.referrerKind[kindOrDetail as ReferrerKind] ?? '');

  if (value) {
    return (
      <View style={{ gap: 6 }}>
        <Muted>{t('referredBy')}</Muted>
        <Body>
          {value.name} · {value.code} · {who(value.type, value.kind)}
        </Body>
        <Button title={t('removeReferral')} variant="secondary" onPress={() => onChange(null)} />
      </View>
    );
  }
  if (adding) {
    return (
      <View style={{ gap: 8 }}>
        <H2>{t('addReferrer')}</H2>
        <ErrorNotice error={error} />
        <Field label={t('referrerName')} value={name} onChangeText={setName} />
        <Field
          label={t('phone')}
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
          maxLength={14}
        />
        <Choice
          label={t('referrerKind')}
          value={kind}
          onChange={(v) => setKind(v as ReferrerKind)}
          options={REFERRER_KINDS.map((k) => ({ value: k, label: labels.referrerKind[k] }))}
        />
        <Button
          title={t('referrerSave')}
          busy={busy}
          disabled={name.trim().length < 2 || phone.replace(/\D/g, '').length < 10}
          onPress={() =>
            void (async () => {
              setBusy(true);
              setError(null);
              try {
                const r = await api.post<ReferredBy>('/v1/referrers', { name, phone, kind });
                onChange({ ...r, type: 'REFERRER' });
                setAdding(false);
              } catch (err) {
                setError(err);
              } finally {
                setBusy(false);
              }
            })()
          }
        />
        <Button title={t('cancel')} variant="secondary" onPress={() => setAdding(false)} />
      </View>
    );
  }
  const items = (results.data?.items ?? []).filter(
    (o) => !(o.type === 'DRIVER' && o.id === excludeDriverId),
  );
  return (
    <View style={{ gap: 6 }}>
      <Field
        testID="referral-search"
        label={t('referredBy')}
        placeholder={t('referralSearch')}
        value={search}
        onChangeText={setSearch}
      />
      <ErrorNotice error={results.error} />
      {q.length >= 2 &&
        (items.length === 0 && !results.loading ? (
          <Muted>{t('referralNone')}</Muted>
        ) : (
          items.map((o) => (
            <Button
              key={`${o.type}-${o.id}`}
              variant="secondary"
              title={`${o.name} · ${o.code} · ${o.type === 'DRIVER' ? t('voltNeoDriver') : who(o.type, o.detail)}`}
              onPress={() =>
                onChange({
                  type: o.type,
                  id: o.id,
                  code: o.code,
                  name: o.name,
                  phone: o.phone,
                  kind: o.type === 'REFERRER' ? o.detail : null,
                })
              }
            />
          ))
        ))}
      <Button title={`+ ${t('addReferrer')}`} variant="secondary" onPress={() => setAdding(true)} />
    </View>
  );
}

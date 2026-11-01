import { useState } from 'react';
import { View } from 'react-native';
import { REGISTRATION_CONSENT, type DriverLanguage, type OnboardingStage } from '@voltneo/shared';
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

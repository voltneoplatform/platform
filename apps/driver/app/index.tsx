import { useEffect, useState } from 'react';
import { AppState, Text, View } from 'react-native';
import { router } from 'expo-router';
import type { DueNow } from '@voltneo/shared';
import { rupees, shortDate } from '@/i18n';
import { openPage } from '@/pdf';
import { useSession } from '@/session';
import type { Me, MyAgreement } from '@/types';
import {
  Badge,
  Button,
  C,
  Card,
  ErrorNotice,
  Field,
  H1,
  H2,
  KV,
  Loading,
  Muted,
  Notice,
  Screen,
  Tile,
  useLoad,
} from '@/ui';

function DueCard({ a, onPaid }: { a: MyAgreement; onPaid: () => void }) {
  const { t, api } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const due: DueNow = a.due;

  let headline: string;
  let detail: string | null = null;
  let tone: 'danger' | 'warn' | 'info' | 'success' = 'info';
  switch (due.kind) {
    case 'OVERDUE':
      headline = t('dueOverdue', { date: shortDate(due.since) });
      detail =
        due.lateFees > 0
          ? t('dueOverdueDetail', { count: due.instalments, fees: rupees(due.lateFees) })
          : t('dueOverdueCount', { count: due.instalments });
      tone = 'danger';
      break;
    case 'DUE_TODAY':
      headline = t('dueToday');
      tone = 'warn';
      break;
    case 'UPCOMING':
      headline = t('dueUpcoming', { date: shortDate(due.dueDate) });
      break;
    case 'DOWN_PAYMENT':
      headline = t('dueDownPayment');
      break;
    case 'NOT_YET':
      headline = t('notYet', { amount: rupees(due.nextAmount), date: shortDate(due.dueDate) });
      detail = t('payFrom', { date: shortDate(due.payableFrom) });
      break;
    default:
      headline = ['PAID_OFF', 'EARLY_EXIT', 'TRANSFERRED'].includes(a.state)
        ? t('paidOff')
        : t('nothingToPay');
      tone = 'success';
  }

  async function pay() {
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ url: string }>(`/v1/me/agreements/${a.id}/pay`);
      await openPage(r.url);
      onPaid();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const color = tone === 'danger' ? C.danger : tone === 'success' ? C.success : C.ink;
  return (
    <Card>
      <Muted>{due.amount > 0 ? t('dueTitle') : t('nextTitle')}</Muted>
      {due.amount > 0 && (
        <Text style={{ fontSize: 34, fontWeight: '800', color }}>{rupees(due.amount)}</Text>
      )}
      <Text style={{ fontSize: 17, fontWeight: '700', color }}>{headline}</Text>
      {detail && <Muted>{detail}</Muted>}
      {a.dueByAutopay && (
        <Notice tone="info">
          {t('autopayDue', { date: shortDate(a.autopay.nextCharge?.date ?? null) })}
        </Notice>
      )}
      {due.kind === 'OVERDUE' && a.autopay.status === 'ACTIVE' && (
        <Muted>{t('autopayOverdue')}</Muted>
      )}
      {due.amount > 0 && !a.dueByAutopay && (
        <>
          <Button
            testID="pay"
            title={t('payButton', { amount: rupees(due.amount) })}
            busy={busy}
            onPress={() => void pay()}
          />
          <Muted>{t('payHint')}</Muted>
          <Muted>{t('payBack')}</Muted>
        </>
      )}
      <ErrorNotice error={error} />
    </Card>
  );
}

function AutopayCard({ a, onChange }: { a: MyAgreement; onChange: () => void }) {
  const { t, api } = useSession();
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const ap = a.autopay;
  if (ap.status === 'OFF' && !ap.available) return null;

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChange();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  }

  const start = (method: 'UPI' | 'ENACH') =>
    run(async () => {
      const r = await api.post<{ url: string }>(`/v1/me/agreements/${a.id}/autopay`, { method });
      await openPage(r.url);
    });
  const enach = ap.method === 'ENACH';
  const stop = () =>
    run(async () => {
      await api.post(`/v1/me/agreements/${a.id}/autopay/cancel`);
    });

  return (
    <Card>
      <H2>{t('autopayTitle')}</H2>
      {ap.status === 'OFF' && (
        <>
          <Muted>{t('autopayIntro', { amount: rupees(ap.maxAmount) })}</Muted>
          {ap.methods.UPI.available && (
            <>
              <Button
                testID="autopay-upi"
                title={t('autopayUpi')}
                variant="secondary"
                busy={busy}
                onPress={() => void start('UPI')}
              />
              <Muted>{t('autopayUpiHint')}</Muted>
            </>
          )}
          {ap.methods.ENACH.available && (
            <>
              <Button
                testID="autopay-enach"
                title={t('autopayEnach')}
                variant="secondary"
                busy={busy}
                onPress={() => void start('ENACH')}
              />
              <Muted>{t('autopayEnachHint')}</Muted>
            </>
          )}
        </>
      )}
      {ap.status === 'PENDING' && (
        <>
          <Notice tone="warn">{enach ? t('autopayPendingEnach') : t('autopayPending')}</Notice>
          <Button
            title={t('autopayApprove')}
            busy={busy}
            onPress={() =>
              void (ap.approvalUrl ? openPage(ap.approvalUrl) : start(ap.method ?? 'UPI'))
            }
          />
        </>
      )}
      {ap.status === 'ACTIVE' && (
        <>
          <Badge text={t('autopayOn')} tone="success" />
          <Muted>{t('autopayVia', { method: enach ? t('autopayEnach') : t('autopayUpi') })}</Muted>
          <Muted>
            {ap.nextCharge
              ? t(enach ? 'autopayNextEnach' : 'autopayNext', {
                  amount: rupees(ap.nextCharge.amount),
                  date: shortDate(ap.nextCharge.date),
                })
              : t('autopayIdle')}
          </Muted>
        </>
      )}
      {ap.status !== 'OFF' &&
        (confirm ? (
          <>
            <Notice tone="warn">{t('autopayStopConfirm')}</Notice>
            <Button title={t('yes')} variant="danger" busy={busy} onPress={() => void stop()} />
            <Button title={t('cancel')} variant="secondary" onPress={() => setConfirm(false)} />
          </>
        ) : (
          <Button
            testID="autopay-stop"
            title={ap.status === 'PENDING' ? t('cancel') : t('autopayStop')}
            variant="secondary"
            onPress={() => setConfirm(true)}
          />
        ))}
      <ErrorNotice error={error} />
    </Card>
  );
}

/** The driver's email for receipts (optional; founder, 31 Oct 2026). */
function EmailCard() {
  const { t, api } = useSession();
  const { data, setData } = useLoad(() => api.get<Me>('/v1/me'), [api]);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  if (!data) return null;
  const email = data.driver.email;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      setData(await api.patch<Me>('/v1/me', { email: value.trim() || null }));
      setEditing(false);
      setSaved(true);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <H2>{t('emailTitle')}</H2>
      {editing ? (
        <>
          <Field
            testID="email"
            label={t('emailLabel')}
            value={value}
            onChangeText={setValue}
            keyboardType="email-address"
            autoCapitalize="none"
            maxLength={254}
          />
          <ErrorNotice error={error} />
          <Button
            testID="email-save"
            title={t('emailSave')}
            busy={busy}
            onPress={() => void save()}
          />
          <Button title={t('cancel')} variant="secondary" onPress={() => setEditing(false)} />
        </>
      ) : (
        <>
          <Muted>{email ?? t('emailNone')}</Muted>
          {saved && <Notice tone="success">{t('emailSaved')}</Notice>}
          <Button
            testID="email-edit"
            title={email ? t('change') : t('add')}
            variant="secondary"
            onPress={() => {
              setValue(email ?? '');
              setSaved(false);
              setEditing(true);
            }}
          />
        </>
      )}
    </Card>
  );
}

export default function Home() {
  const { t, api, driver, labels, signOut } = useSession();
  const { data, error, loading, reload } = useLoad(
    () => api.get<MyAgreement>('/v1/me/agreement'),
    [api],
  );

  // Coming back from the UPI app: show the new balance.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void reload();
    });
    return () => sub.remove();
  }, [reload]);

  const a = data;
  const instalments = a ? a.schedule.filter((l) => l.sequence > 0).length : 0;
  return (
    <Screen onRefresh={() => void reload()} refreshing={loading && !!data}>
      <H1>{t('hello', { name: driver?.name ?? '' })}</H1>
      {loading && !data && <Loading />}
      <ErrorNotice error={error} />
      {a && (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Muted>{t('agreementNo', { number: a.number })}</Muted>
            <Badge
              text={labels.state[a.state]}
              tone={
                a.state === 'IMMOBILISED' || a.state === 'IN_GRACE'
                  ? 'danger'
                  : a.state === 'ACTIVE'
                    ? 'success'
                    : 'plain'
              }
            />
          </View>
          {a.state === 'IMMOBILISED' && <Notice tone="danger">{t('immobilised')}</Notice>}
          <DueCard a={a} onPaid={() => void reload()} />
          <AutopayCard a={a} onChange={() => void reload()} />
          {instalments > 0 && (
            <Card>
              <KV k={t('progress', { paid: a.money.instalmentsPaid, total: instalments })} v="" />
              <KV
                k={t('stillToPay')}
                v={rupees(a.money.outstanding + a.money.lateFeesDue)}
                strong
              />
            </Card>
          )}
        </>
      )}
      <Tile
        testID="tile-receipts"
        title={t('receipts')}
        subtitle={t('receiptsSub')}
        onPress={() => router.push('/receipts')}
      />
      <Tile
        testID="tile-agreement"
        title={t('myAgreement')}
        subtitle={t('myAgreementSub')}
        onPress={() => router.push('/agreement')}
      />
      <Tile
        testID="tile-help"
        title={t('help')}
        subtitle={t('helpSub')}
        onPress={() => router.push('/help')}
      />
      <EmailCard />
      <Button title={t('signOut')} variant="secondary" onPress={() => void signOut()} />
    </Screen>
  );
}

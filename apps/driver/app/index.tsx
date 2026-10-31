import { useEffect, useState } from 'react';
import { AppState, Text, View } from 'react-native';
import { router } from 'expo-router';
import type { DueNow } from '@voltneo/shared';
import { rupees, shortDate } from '@/i18n';
import { openPage } from '@/pdf';
import { useSession } from '@/session';
import type { MyAgreement } from '@/types';
import {
  Badge,
  Button,
  C,
  Card,
  ErrorNotice,
  H1,
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
      {due.amount > 0 && (
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
      <Button title={t('signOut')} variant="secondary" onPress={() => void signOut()} />
    </Screen>
  );
}

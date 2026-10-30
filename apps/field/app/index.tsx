import { Stack, router } from 'expo-router';
import { rupees } from '@/i18n';
import { useSession } from '@/session';
import { Button, ErrorNotice, H1, Muted, Screen, Tile, useLoad } from '@/ui';

interface Summary {
  today: string;
  cash: {
    held: number;
    awaitingCheck: number;
    collectedToday: number;
    paymentsToday: number;
  } | null;
  installationsWaiting: number | null;
  myOpenTickets: number | null;
  myMissedTickets: number | null;
  recoveryJobs: number | null;
}

export default function Home() {
  const { t, staff, can, api, signOut, labels } = useSession();
  const { data, error, loading, reload } = useLoad(
    () => api.get<Summary>('/v1/field/summary'),
    [api],
  );
  if (!staff) return null;
  return (
    <Screen onRefresh={() => void reload()} refreshing={loading && !!data}>
      <Stack.Screen options={{ title: t('appName') }} />
      <H1>{t('hello', { name: staff.name.split(' ')[0] ?? staff.name })}</H1>
      <Muted>{labels.role[staff.role]}</Muted>
      <ErrorNotice error={error} />
      {error ? (
        <Button title={t('retry')} variant="secondary" onPress={() => void reload()} />
      ) : null}

      {can('drivers.read') && (
        <Tile testID="tile-drivers" title={t('drivers')} onPress={() => router.push('/drivers')} />
      )}
      {data?.cash && (
        <Tile
          testID="tile-cash"
          title={t('cashHeld')}
          count={rupees(data.cash.held)}
          subtitle={t('collectedToday', {
            amount: rupees(data.cash.collectedToday),
            count: data.cash.paymentsToday,
          })}
          onPress={() => router.push('/cash')}
        />
      )}
      {data && data.installationsWaiting !== null && (
        <Tile
          testID="tile-installations"
          title={t('installationsWaiting')}
          count={data.installationsWaiting}
          onPress={() => router.push('/installations')}
        />
      )}
      {data && data.myOpenTickets !== null && (
        <Tile
          testID="tile-tickets"
          title={t('myTickets')}
          count={data.myOpenTickets}
          alert={data.myMissedTickets ? t('missedCount', { count: data.myMissedTickets }) : null}
          onPress={() => router.push('/tickets')}
        />
      )}
      {data && data.recoveryJobs !== null && (
        <Tile
          testID="tile-recoveries"
          title={t('recoveriesToCollect')}
          count={data.recoveryJobs}
          onPress={() => router.push('/recoveries')}
        />
      )}

      <Button title={t('signOut')} variant="secondary" onPress={() => void signOut()} />
    </Screen>
  );
}

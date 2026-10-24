import { Pressable } from 'react-native';
import { Stack, router } from 'expo-router';
import { shortDate } from '@/i18n';
import type { RecoveryJob } from '@/recoveries';
import { useSession } from '@/session';
import { Body, C, ErrorNotice, Loading, Muted, Screen, useLoad } from '@/ui';

export default function Recoveries() {
  const { t, api } = useSession();
  const { data, error, loading, reload } = useLoad(
    () => api.get<RecoveryJob[]>('/v1/field/recoveries'),
    [api],
  );
  return (
    <Screen onRefresh={() => void reload()} refreshing={loading && !!data}>
      <Stack.Screen options={{ title: t('recoveriesToCollect') }} />
      <ErrorNotice error={error} />
      {!data && <Loading />}
      {data?.length === 0 && <Muted>{t('noRecoveries')}</Muted>}
      {data?.map((j) => (
        <Pressable
          key={j.agreementId}
          accessibilityRole="button"
          onPress={() => router.push(`/recoveries/${j.agreementId}`)}
          style={{
            backgroundColor: C.card,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: C.border,
            padding: 14,
            gap: 4,
          }}
        >
          <Body style={{ fontWeight: '700' }}>
            {j.driver.name} · {j.number}
          </Body>
          <Muted>{j.driver.address}</Muted>
          <Muted>
            {j.battery?.serial} · {j.vehicle} · {t('approvedOn', { date: shortDate(j.approvedAt) })}
          </Muted>
        </Pressable>
      ))}
    </Screen>
  );
}

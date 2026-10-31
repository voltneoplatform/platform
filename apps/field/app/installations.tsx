import { Pressable } from 'react-native';
import { Stack, router } from 'expo-router';
import { shortDate } from '@/i18n';
import { useSession } from '@/session';
import { Body, C, ErrorNotice, Loading, Muted, Screen, useLoad } from '@/ui';

interface Row {
  id: string;
  number: string;
  driver: { name: string; phone: string };
  batteryType: string;
  firstDueDate: string;
  installationWaiting: boolean;
}

export default function Installations() {
  const { t, api } = useSession();
  const { data, error, loading, reload } = useLoad(
    () => api.get<{ items: Row[] }>('/v1/agreements?state=AWAITING_INSTALLATION&limit=100'),
    [api],
  );
  return (
    <Screen onRefresh={() => void reload()} refreshing={loading && !!data}>
      <Stack.Screen options={{ title: t('installationsWaiting') }} />
      <ErrorNotice error={error} />
      {!data && <Loading />}
      {data?.items.length === 0 && <Muted>{t('noInstallations')}</Muted>}
      {data?.items.map((a) => (
        <Pressable
          key={a.id}
          accessibilityRole="button"
          onPress={() =>
            router.push(
              a.installationWaiting ? `/agreements/${a.id}` : `/agreements/${a.id}/install`,
            )
          }
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
            {a.driver.name} · {a.number}
          </Body>
          <Muted>
            {a.driver.phone} · {a.batteryType} ·{' '}
            {t('firstDue', { date: shortDate(a.firstDueDate) })}
          </Muted>
          {a.installationWaiting && (
            <Muted style={{ color: C.success }}>{t('installWaiting')}</Muted>
          )}
        </Pressable>
      ))}
    </Screen>
  );
}

import { Pressable, View } from 'react-native';
import { Stack, router } from 'expo-router';
import { hoursMinutes, shortDate } from '@/i18n';
import { useSession } from '@/session';
import { timingTone, type TicketRow } from '@/tickets';
import { Badge, Body, C, ErrorNotice, Loading, Muted, Screen, useLoad } from '@/ui';

export default function MyTickets() {
  const { t, api, staff, labels } = useSession();
  const { data, error, loading, reload } = useLoad(
    () =>
      api.get<{ items: TicketRow[] }>(
        `/v1/tickets?technicianId=${staff?.id ?? ''}&active=true&limit=100`,
      ),
    [api, staff?.id],
  );
  return (
    <Screen onRefresh={() => void reload()} refreshing={loading && !!data}>
      <Stack.Screen options={{ title: t('myTickets') }} />
      <ErrorNotice error={error} />
      {!data && <Loading />}
      {data?.items.length === 0 && <Muted>{t('noTickets')}</Muted>}
      {data?.items.map((k) => {
        const left = new Date(k.dueBy).getTime() - Date.now();
        return (
          <Pressable
            key={k.id}
            accessibilityRole="button"
            onPress={() => router.push(`/tickets/${k.id}`)}
            style={{
              backgroundColor: C.card,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: k.timing === 'MISSED' ? C.danger : C.border,
              padding: 14,
              gap: 4,
            }}
          >
            <Body style={{ fontWeight: '700' }}>
              {labels.ticketCategory[k.category]} · {k.driver.name}
            </Body>
            <Muted>
              {k.number} · {k.batterySerial} ·{' '}
              {t('reported', { time: shortDate(k.reportedAt, true) })}
            </Muted>
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              <Badge tone={timingTone(k.timing)} text={labels.ticketTiming[k.timing]} />
              {!k.respondedAt && (
                <Muted>
                  {left >= 0
                    ? t('hoursLeft', { time: hoursMinutes(left) })
                    : t('hoursLate', { time: hoursMinutes(left) })}
                </Muted>
              )}
            </View>
          </Pressable>
        );
      })}
    </Screen>
  );
}

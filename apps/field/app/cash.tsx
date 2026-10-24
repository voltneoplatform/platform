import { Pressable, View } from 'react-native';
import { Stack, router } from 'expo-router';
import { rupees, shortDate } from '@/i18n';
import { useSession } from '@/session';
import { Badge, Body, C, Card, ErrorNotice, H2, KV, Loading, Muted, Screen, useLoad } from '@/ui';

interface MyCash {
  held: number;
  awaitingCheck: number;
  payments: {
    id: string;
    receiptNumber: string;
    amount: number;
    receivedAt: string;
    agreement: { id: string; number: string };
    driverName: string;
  }[];
  deposits: {
    id: string;
    amount: number;
    bankReference: string;
    depositedAt: string;
    status: 'PENDING' | 'RECONCILED';
  }[];
}

export default function Cash() {
  const { t, api } = useSession();
  const { data, error, loading, reload } = useLoad(() => api.get<MyCash>('/v1/field/cash'), [api]);
  return (
    <Screen onRefresh={() => void reload()} refreshing={loading && !!data}>
      <Stack.Screen options={{ title: t('myCash') }} />
      <ErrorNotice error={error} />
      {!data ? (
        <Loading />
      ) : (
        <>
          <Card>
            <KV k={t('youHold')} v={rupees(data.held)} strong />
            <KV k={t('awaitingCheck')} v={rupees(data.awaitingCheck)} />
            <Muted>{t('depositReminder')}</Muted>
          </Card>
          <Card>
            <H2>{t('cashYouCollected')}</H2>
            {data.payments.length === 0 && <Muted>{t('noCashYet')}</Muted>}
            {data.payments.map((p) => (
              <Pressable
                key={p.id}
                accessibilityRole="button"
                onPress={() => router.push(`/agreements/${p.agreement.id}`)}
                style={{ borderTopWidth: 1, borderTopColor: C.border, paddingVertical: 8 }}
              >
                <Body style={{ fontWeight: '700' }}>
                  {rupees(p.amount)} · {p.driverName}
                </Body>
                <Muted>
                  {p.receiptNumber} · {p.agreement.number} · {shortDate(p.receivedAt, true)}
                </Muted>
              </Pressable>
            ))}
          </Card>
          {data.deposits.length > 0 && (
            <Card>
              <H2>{t('bankDeposits')}</H2>
              {data.deposits.map((d) => (
                <View key={d.id} style={{ paddingVertical: 6, gap: 4 }}>
                  <Body>
                    {rupees(d.amount)} · {shortDate(d.depositedAt)} · {d.bankReference}
                  </Body>
                  <Badge
                    tone={d.status === 'RECONCILED' ? 'success' : 'warn'}
                    text={d.status === 'RECONCILED' ? t('depositChecked') : t('awaitingCheck')}
                  />
                </View>
              ))}
            </Card>
          )}
        </>
      )}
    </Screen>
  );
}

import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Stack, router } from 'expo-router';
import { useSession } from '@/session';
import { Badge, Body, Button, C, ErrorNotice, Field, Loading, Muted, Screen, useLoad } from '@/ui';

interface DriverRow {
  id: string;
  name: string;
  phone: string;
  district: string;
  vehicle: { registration: string | null } | null;
  ready: boolean;
  itemsDone: number;
  itemsTotal: number;
}

export default function Drivers() {
  const { t, api, can } = useSession();
  const [search, setSearch] = useState('');
  const q = search.trim();
  const { data, error, loading, reload } = useLoad(
    () =>
      api.get<{ items: DriverRow[] }>(
        `/v1/drivers?limit=50${q.length >= 2 ? `&search=${encodeURIComponent(q)}` : ''}`,
      ),
    [api, q.length >= 2 ? q : ''],
  );
  return (
    <Screen onRefresh={() => void reload()} refreshing={loading && !!data}>
      <Stack.Screen options={{ title: t('drivers') }} />
      {can('drivers.manage') && (
        <Button
          testID="register-driver"
          title={t('registerDriver')}
          onPress={() => router.push('/drivers/new')}
        />
      )}
      <Field
        label={t('searchDrivers')}
        value={search}
        onChangeText={setSearch}
        autoCapitalize="none"
      />
      <ErrorNotice error={error} />
      {!data && loading && <Loading />}
      {data?.items.length === 0 && <Muted>{t('noDrivers')}</Muted>}
      {data?.items.map((d) => (
        <Pressable
          key={d.id}
          accessibilityRole="button"
          onPress={() => router.push(`/drivers/${d.id}`)}
          style={{
            backgroundColor: C.card,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: C.border,
            padding: 14,
            gap: 4,
          }}
        >
          <Body style={{ fontWeight: '700' }}>{d.name}</Body>
          <Muted>
            {d.phone}
            {d.vehicle?.registration ? ` · ${d.vehicle.registration}` : ''} · {d.district}
          </Muted>
          <View>
            {d.ready ? (
              <Badge tone="success" text={t('readyToSign')} />
            ) : (
              <Badge
                tone="warn"
                text={t('stepsDone', { done: d.itemsDone, total: d.itemsTotal })}
              />
            )}
          </View>
        </Pressable>
      ))}
    </Screen>
  );
}

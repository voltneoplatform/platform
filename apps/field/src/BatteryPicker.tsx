import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useSession } from './session';
import { Body, Button, C, ErrorNotice, Field, Loading, Muted, useLoad } from './ui';

export interface StockBattery {
  id: string;
  serial: string;
  gpsDeviceId: string | null;
  location: string | null;
}

/** In-stock batteries of one type with a GPS module, searchable by serial. */
export function BatteryPicker({
  typeId,
  value,
  onChange,
}: {
  typeId: string;
  value: StockBattery | null;
  onChange: (b: StockBattery | null) => void;
}) {
  const { t, api } = useSession();
  const [search, setSearch] = useState('');
  const stock = useLoad(
    () =>
      api.get<{ items: StockBattery[] }>(
        `/v1/batteries?status=IN_STOCK&batteryTypeId=${typeId}&limit=200`,
      ),
    [api, typeId],
  );
  const q = search.replace(/\s+/g, '').toUpperCase();
  const options = (stock.data?.items ?? [])
    .filter((b) => b.gpsDeviceId)
    .filter((b) => !q || b.serial.includes(q));
  if (value) {
    return (
      <View style={{ gap: 6 }}>
        <Body style={{ fontWeight: '700' }}>
          {t('battery')}: {value.serial}
        </Body>
        <Muted>GPS {value.gpsDeviceId}</Muted>
        <Button title={t('changeBattery')} variant="secondary" onPress={() => onChange(null)} />
      </View>
    );
  }
  return (
    <View style={{ gap: 6 }}>
      <Field
        testID="serial-search"
        label={t('serialSearch')}
        value={search}
        onChangeText={setSearch}
        autoCapitalize="characters"
      />
      <ErrorNotice error={stock.error} />
      {stock.loading && !stock.data && <Loading />}
      {stock.data && options.length === 0 && <Muted>{t('noBatteryInStock')}</Muted>}
      {options.slice(0, 8).map((b) => (
        <Pressable
          key={b.id}
          accessibilityRole="button"
          onPress={() => onChange(b)}
          style={{ borderWidth: 1, borderColor: C.border, borderRadius: 10, padding: 12 }}
        >
          <Body style={{ fontWeight: '700' }}>{b.serial}</Body>
          <Muted>
            GPS {b.gpsDeviceId}
            {b.location ? ` · ${b.location}` : ''}
          </Muted>
        </Pressable>
      ))}
    </View>
  );
}

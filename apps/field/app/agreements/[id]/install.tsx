import { useState } from 'react';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { shortDate } from '@/i18n';
import { appendPhotos, type Photo } from '@/photos';
import { BatteryPicker, type StockBattery } from '@/BatteryPicker';
import { useSession } from '@/session';
import {
  Button,
  Card,
  Check,
  ErrorNotice,
  Field,
  H2,
  Loading,
  Muted,
  Photos,
  Screen,
  useLoad,
} from '@/ui';

interface Agreement {
  id: string;
  number: string;
  driver: { name: string };
  vehicle: { registration: string | null };
  batteryType: { id: string; name: string };
  terms: { firstDueDate: string };
}

export default function Install() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, api, staff } = useSession();
  const ag = useLoad(() => api.get<Agreement>(`/v1/agreements/${id}`), [api, id]);
  const [battery, setBattery] = useState<StockBattery | null>(null);
  const [voltage, setVoltage] = useState('');
  const [location, setLocation] = useState('');
  const [condition, setCondition] = useState('');
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const a = ag.data;
  if (!a || !staff) {
    return (
      <Screen>
        <ErrorNotice error={ag.error} />
        <Loading />
      </Screen>
    );
  }
  const ready =
    !!battery &&
    Number(voltage) > 0 &&
    location.trim().length >= 3 &&
    condition.trim().length >= 3 &&
    photos.length > 0 &&
    confirmed;
  return (
    <Screen>
      <Stack.Screen options={{ title: t('recordInstallation') }} />
      <Card>
        <H2>
          {a.number} · {a.driver.name}
        </H2>
        <Muted>
          {a.batteryType.name}
          {a.vehicle.registration ? ` · ${a.vehicle.registration}` : ''} ·{' '}
          {t('firstDue', { date: shortDate(a.terms.firstDueDate) })}
        </Muted>
      </Card>
      <Card>
        <BatteryPicker typeId={a.batteryType.id} value={battery} onChange={setBattery} />
      </Card>
      <Card>
        <Field
          testID="voltage"
          label={t('voltage')}
          value={voltage}
          onChangeText={(v) => setVoltage(v.replace(/[^\d.]/g, ''))}
          keyboardType="decimal-pad"
        />
        <Field
          testID="location"
          label={t('whereInstalled')}
          value={location}
          onChangeText={setLocation}
        />
        <Field
          testID="condition"
          label={t('conditionChecks')}
          value={condition}
          onChangeText={setCondition}
          multiline
        />
        <Photos photos={photos} onChange={setPhotos} />
        {photos.length === 0 && <Muted>{t('photoNeeded')}</Muted>}
        <Check label={t('driverConfirmed')} value={confirmed} onChange={setConfirmed} />
      </Card>
      <ErrorNotice error={error} />
      <Button
        testID="save-installation"
        title={t('recordInstallation')}
        busy={busy}
        disabled={!ready}
        onPress={() =>
          void (async () => {
            setBusy(true);
            setError(null);
            try {
              const form = new FormData();
              form.append('batteryId', battery!.id);
              form.append('technicianId', staff.id);
              form.append('installedAt', new Date().toISOString());
              form.append('location', location.trim());
              form.append('voltageReading', voltage);
              form.append('conditionNote', condition.trim());
              form.append('driverConfirmed', 'true');
              await appendPhotos(form, 'photos', photos);
              await api.upload(`/v1/agreements/${a.id}/installation`, form);
              router.replace(`/agreements/${a.id}?done=installed`);
            } catch (err) {
              setError(err);
              setBusy(false);
            }
          })()
        }
      />
    </Screen>
  );
}

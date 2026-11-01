import { useState } from 'react';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { shortDate } from '@/i18n';
import { appendPhotos, type Photo } from '@/photos';
import { useGeotag } from '@/location';
import { LocationNotice } from '@/onboarding';
import { useSession } from '@/session';
import {
  Body,
  Button,
  Card,
  Check,
  ErrorNotice,
  Field,
  H2,
  Loading,
  Muted,
  Notice,
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
  /** Founder, 1 Nov 2026: assigned when the agreement is prepared; this one is installed. */
  battery: { id: string; serial: string; gpsDeviceId: string | null } | null;
  resignRequired: boolean;
  terms: { firstDueDate: string };
}

export default function Install() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, api, staff } = useSession();
  const ag = useLoad(() => api.get<Agreement>(`/v1/agreements/${id}`), [api, id]);
  const [serialChecked, setSerialChecked] = useState(false);
  const geo = useGeotag();
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
  const battery = a.battery;
  const ready =
    !!battery &&
    !a.resignRequired &&
    serialChecked &&
    !!geo.geo &&
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
      {a.resignRequired && <Notice tone="warn">{t('resignNeeded')}</Notice>}
      {battery && (
        <Card>
          <H2>{t('assignedBattery')}</H2>
          <Body style={{ fontWeight: '700', fontSize: 18 }}>{battery.serial}</Body>
          {battery.gpsDeviceId && <Muted>{t('imei', { imei: battery.gpsDeviceId })}</Muted>}
          <Check
            label={t('serialChecked', { serial: battery.serial })}
            value={serialChecked}
            onChange={setSerialChecked}
          />
        </Card>
      )}
      <LocationNotice state={geo.state} onRetry={() => void geo.retry()} />
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
              form.append('geoLat', String(geo.geo!.lat));
              form.append('geoLng', String(geo.geo!.lng));
              form.append('geoAccuracyM', String(geo.geo!.accuracyM));
              form.append('installedAt', new Date().toISOString());
              form.append('location', location.trim());
              form.append('voltageReading', voltage);
              form.append('conditionNote', condition.trim());
              form.append('driverConfirmed', 'true');
              await appendPhotos(form, 'photos', photos);
              const res = await api.upload<{ state: string }>(
                `/v1/agreements/${a.id}/installation`,
                form,
              );
              // Head office verifies installations recorded in the field (founder, 31 Oct 2026).
              router.replace(
                `/agreements/${a.id}?done=${res.state === 'ACTIVE' ? 'installed' : 'installRecorded'}`,
              );
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

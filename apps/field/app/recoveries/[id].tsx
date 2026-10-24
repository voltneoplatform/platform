import { useState } from 'react';
import { Linking } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { shortDate } from '@/i18n';
import { appendPhotos, type Photo } from '@/photos';
import type { RecoveryJob } from '@/recoveries';
import { useSession } from '@/session';
import {
  Body,
  Button,
  Card,
  Check,
  ErrorNotice,
  Field,
  H1,
  KV,
  Loading,
  Muted,
  Notice,
  Photos,
  Screen,
  useLoad,
} from '@/ui';

export default function Recovery() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, api, staff } = useSession();
  const jobs = useLoad(() => api.get<RecoveryJob[]>('/v1/field/recoveries'), [api]);
  const [place, setPlace] = useState('');
  const [condition, setCondition] = useState('');
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [serialOk, setSerialOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState(false);
  const j = jobs.data?.find((x) => x.agreementId === id);

  if (done) {
    return (
      <Screen>
        <Notice tone="success">{t('recovered')}</Notice>
        <Button title={t('back')} onPress={() => router.replace('/recoveries')} />
      </Screen>
    );
  }
  if (!j || !staff) {
    return (
      <Screen>
        <ErrorNotice error={jobs.error} />
        {jobs.loading ? <Loading /> : <Muted>{t('noRecoveries')}</Muted>}
      </Screen>
    );
  }
  return (
    <Screen>
      <Stack.Screen options={{ title: j.number }} />
      <H1>{j.driver.name}</H1>
      <Card>
        <KV k={t('address')} v={j.driver.address} />
        <KV k={t('battery')} v={j.battery?.serial ?? '—'} strong />
        {j.vehicle && <KV k={t('vehicleRegistration')} v={j.vehicle} />}
        <Muted>{t('disabledSince', { date: shortDate(j.disabledOn) })}</Muted>
        <Button
          title={`${t('callDriver')} · ${j.driver.phone}`}
          variant="secondary"
          onPress={() => void Linking.openURL(`tel:${j.driver.phone}`)}
        />
      </Card>
      <Notice tone="warn">{t('conductCode')}</Notice>
      <Card>
        <Field testID="place" label={t('placeCollected')} value={place} onChangeText={setPlace} />
        <Field
          testID="recovery-condition"
          label={t('conditionCollected')}
          value={condition}
          onChangeText={setCondition}
          multiline
        />
        <Photos photos={photos} onChange={setPhotos} />
        {j.battery && (
          <Check
            label={<Body>{t('confirmSerial', { serial: j.battery.serial })}</Body>}
            value={serialOk}
            onChange={setSerialOk}
          />
        )}
      </Card>
      <ErrorNotice error={error} />
      <Button
        testID="save-recovery"
        title={t('recordRecovery')}
        variant="danger"
        busy={busy}
        disabled={!j.battery || !serialOk || place.trim().length < 3 || condition.trim().length < 3}
        onPress={() =>
          void (async () => {
            setBusy(true);
            setError(null);
            try {
              const form = new FormData();
              form.append('batteryId', j.battery!.id);
              form.append('recoveredById', staff.id);
              form.append('recoveredAt', new Date().toISOString());
              form.append('location', place.trim());
              form.append('conditionNote', condition.trim());
              await appendPhotos(form, 'photos', photos);
              await api.upload(`/v1/agreements/${j.agreementId}/recovery`, form);
              setDone(true);
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

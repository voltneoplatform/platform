import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import {
  KYC_DOC_INFO,
  KYC_DOC_TYPES,
  type AgreementState,
  type KycDocType,
  type ReadinessItem,
} from '@voltneo/shared';
import { rupees } from '@/i18n';
import { appendPhotos, type Photo } from '@/photos';
import { useSession } from '@/session';
import {
  Badge,
  Body,
  Button,
  C,
  Card,
  Check,
  Choice,
  ErrorNotice,
  Field,
  H1,
  H2,
  Loading,
  Muted,
  Notice,
  Photos,
  Screen,
  useLoad,
} from '@/ui';

interface DriverDetail {
  id: string;
  name: string;
  phone: string;
  addressLine: string;
  area: string | null;
  district: string;
  vehicle: { registration: string | null; ownedByDriver: boolean } | null;
  documents: {
    id: string;
    type: KycDocType;
    maskedNumber: string | null;
    status: 'PENDING' | 'VERIFIED' | 'REJECTED';
    rejectionReason: string | null;
  }[];
  readiness: { ready: boolean; items: { item: ReadinessItem; done: boolean; applies: boolean }[] };
}

interface AgreementRow {
  id: string;
  number: string;
  state: AgreementState;
  outstanding: number;
}

export default function DriverPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, api, labels, can } = useSession();
  const driver = useLoad(() => api.get<DriverDetail>(`/v1/drivers/${id}`), [api, id]);
  const agreements = useLoad(
    () => api.get<{ items: AgreementRow[] }>(`/v1/agreements?driverId=${id}&limit=20`),
    [api, id],
  );
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const d = driver.data;

  return (
    <Screen
      onRefresh={() => {
        void driver.reload();
        void agreements.reload();
      }}
      refreshing={driver.loading && !!d}
    >
      <Stack.Screen options={{ title: d?.name ?? t('drivers') }} />
      <ErrorNotice error={driver.error} />
      {!d ? (
        <Loading />
      ) : (
        <>
          <H1>{d.name}</H1>
          <Muted>
            {d.phone} · {[d.addressLine, d.area, d.district].filter(Boolean).join(', ')}
          </Muted>
          {message && <Notice tone="success">{message}</Notice>}

          <Card>
            <H2>{t('agreements')}</H2>
            {agreements.data?.items.length === 0 && <Muted>{t('noAgreements')}</Muted>}
            {agreements.data?.items.map((a) => (
              <Pressable
                key={a.id}
                accessibilityRole="button"
                onPress={() => router.push(`/agreements/${a.id}`)}
                style={{
                  borderTopWidth: 1,
                  borderTopColor: C.border,
                  paddingVertical: 10,
                  gap: 4,
                }}
              >
                <Body style={{ fontWeight: '700' }}>{t('agreement', { number: a.number })} ›</Body>
                <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                  <Badge
                    tone={a.state === 'IN_GRACE' || a.state === 'IMMOBILISED' ? 'danger' : 'info'}
                    text={labels.state[a.state]}
                  />
                  <Muted>
                    {t('stillToPay')}: {rupees(a.outstanding)}
                  </Muted>
                </View>
              </Pressable>
            ))}
          </Card>

          <Card>
            <H2>{t('beforeSigning')}</H2>
            {d.readiness.items
              .filter((i) => i.applies)
              .map((i) => (
                <Body key={i.item}>
                  {i.done ? '✓' : '○'} {labels.readiness[i.item]}
                </Body>
              ))}
          </Card>

          <Card>
            <H2>{t('documents')}</H2>
            {d.documents.map((doc) => (
              <View key={doc.id} style={{ gap: 2, paddingVertical: 4 }}>
                <Body>
                  {labels.doc[doc.type]}
                  {doc.maskedNumber ? ` · ${doc.maskedNumber}` : ''}
                </Body>
                <View>
                  {doc.status === 'VERIFIED' ? (
                    <Badge tone="success" text={t('docVerified')} />
                  ) : doc.status === 'REJECTED' ? (
                    <Badge
                      tone="danger"
                      text={t('docRejected', { reason: doc.rejectionReason ?? '' })}
                    />
                  ) : (
                    <Badge tone="warn" text={t('docPending')} />
                  )}
                </View>
              </View>
            ))}
            {can('drivers.manage') &&
              (adding ? (
                <AddDocument
                  driverId={d.id}
                  onDone={async () => {
                    setAdding(false);
                    setMessage(t('uploaded'));
                    await driver.reload();
                  }}
                  onCancel={() => setAdding(false)}
                />
              ) : (
                <Button
                  testID="add-document"
                  title={t('addDocument')}
                  variant="secondary"
                  onPress={() => {
                    setMessage(null);
                    setAdding(true);
                  }}
                />
              ))}
          </Card>
        </>
      )}
    </Screen>
  );
}

function AddDocument({
  driverId,
  onDone,
  onCancel,
}: {
  driverId: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { t, api, labels } = useSession();
  const [type, setType] = useState<KycDocType>('VOTER_ID');
  const [number, setNumber] = useState('');
  const [address, setAddress] = useState(false);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const info = KYC_DOC_INFO[type];
  return (
    <View style={{ gap: 10, borderTopWidth: 1, borderTopColor: C.border, paddingTop: 10 }}>
      <Choice
        label={t('documentType')}
        value={type}
        onChange={(v) => {
          setType(v);
          if (!KYC_DOC_INFO[v].canProveAddress) setAddress(false);
        }}
        options={KYC_DOC_TYPES.map((k) => ({ value: k, label: labels.doc[k] }))}
      />
      {info.hasNumber && (
        <Field
          label={`${t('documentNumber')}${info.formatHint ? ` (${info.formatHint})` : ''}`}
          value={number}
          onChangeText={setNumber}
          autoCapitalize="characters"
        />
      )}
      {info.canProveAddress && (
        <Check label={t('usedForAddress')} value={address} onChange={setAddress} />
      )}
      <Photos photos={photos} onChange={setPhotos} max={1} />
      <ErrorNotice error={error} />
      <Button
        testID="upload-document"
        title={t('upload')}
        busy={busy}
        disabled={photos.length !== 1 || (info.hasNumber && number.trim().length < 4)}
        onPress={() =>
          void (async () => {
            setBusy(true);
            setError(null);
            try {
              const form = new FormData();
              form.append('type', type);
              if (info.hasNumber) form.append('number', number.trim());
              if (address) form.append('usedForAddress', 'true');
              await appendPhotos(form, 'file', photos);
              await api.upload(`/v1/drivers/${driverId}/kyc`, form);
              onDone();
            } catch (err) {
              setError(err);
              setBusy(false);
            }
          })()
        }
      />
      <Button title={t('cancel')} variant="secondary" onPress={onCancel} />
    </View>
  );
}

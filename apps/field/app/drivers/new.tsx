import { useState } from 'react';
import { Stack, router } from 'expo-router';
import {
  RELATIVE_RELATIONS,
  VEHICLE_TYPES,
  type DriverLanguage,
  type RelativeRelation,
  type VehicleType,
} from '@voltneo/shared';
import { ApiError } from '@/api';
import { dmyToIso, typeDate } from '@/dates';
import { LANGS, LANG_NAMES } from '@/i18n';
import { useSession } from '@/session';
import { Button, Card, Check, Choice, ErrorNotice, Field, H2, Muted, Notice, Screen } from '@/ui';

interface Duplicate {
  detail: string;
  driverName: string;
}

export default function NewDriver() {
  const { t, api, labels, lang } = useSession();
  const [f, setF] = useState({
    name: '',
    phone: '',
    dateOfBirth: '',
    email: '',
    relativeName: '',
    addressLine: '',
    area: '',
    district: 'South 24 Parganas',
    pinCode: '',
    nomineeName: '',
    nomineeRelation: '',
    nomineePhone: '',
    registration: '',
    ownerName: '',
    ownerPhone: '',
  });
  const [language, setLanguage] = useState<DriverLanguage>(lang);
  const [vehicleType, setVehicleType] = useState<VehicleType>('TOTO');
  const [relation, setRelation] = useState<RelativeRelation | null>(null);
  const [owns, setOwns] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [dups, setDups] = useState<Duplicate[] | null>(null);
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));

  // Typed as DD-MM-YYYY; the API takes YYYY-MM-DD.
  const dob = f.dateOfBirth ? dmyToIso(f.dateOfBirth) : null;
  const dobInvalid = f.dateOfBirth !== '' && dob === null;

  async function save(acknowledgeDuplicates = false) {
    setBusy(true);
    setError(null);
    try {
      const d = await api.post<{ id: string }>('/v1/drivers', {
        name: f.name,
        phone: f.phone,
        language,
        dateOfBirth: dob,
        email: f.email.trim() || null,
        relativeRelation: relation,
        relativeName: f.relativeName.trim() || null,
        addressLine: f.addressLine,
        area: f.area || null,
        district: f.district,
        pinCode: f.pinCode,
        nomineeName: f.nomineeName || null,
        nomineeRelation: f.nomineeRelation || null,
        nomineePhone: f.nomineePhone || null,
        acknowledgeDuplicates,
        vehicle: {
          registration: f.registration || null,
          type: vehicleType,
          ownedByDriver: owns,
          ownerName: owns ? null : f.ownerName || null,
          ownerPhone: owns ? null : f.ownerPhone || null,
          acknowledgeDuplicates,
        },
      });
      router.replace(`/drivers/${d.id}`);
    } catch (err) {
      const body =
        err instanceof ApiError ? (err.body as { code?: string; duplicates?: Duplicate[] }) : null;
      if (body?.code === 'POSSIBLE_DUPLICATE') setDups(body.duplicates ?? []);
      else setError(err);
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: t('newDriver') }} />
      <Card>
        <Field label={t('name')} value={f.name} onChangeText={set('name')} autoCapitalize="words" />
        <Field
          label={t('phone')}
          value={f.phone}
          onChangeText={set('phone')}
          keyboardType="phone-pad"
        />
        <Field
          label={t('email')}
          value={f.email}
          onChangeText={set('email')}
          keyboardType="email-address"
          autoCapitalize="none"
        />
        <Choice
          label={t('driverLanguage')}
          value={language}
          onChange={setLanguage}
          options={LANGS.map((l) => ({ value: l, label: LANG_NAMES[l] }))}
        />
        <Field
          label={t('dateOfBirth')}
          value={f.dateOfBirth}
          onChangeText={(v) => setF((x) => ({ ...x, dateOfBirth: typeDate(v) }))}
          keyboardType="number-pad"
          placeholder="31-01-1990"
          maxLength={10}
        />
        {dobInvalid && f.dateOfBirth.length === 10 && (
          <Notice tone="danger">{t('dobInvalid')}</Notice>
        )}
        <Choice
          label={t('relativeRelation')}
          value={relation}
          onChange={setRelation}
          options={RELATIVE_RELATIONS.map((r) => ({ value: r, label: labels.relative[r] }))}
        />
        <Field
          label={t('relativeName')}
          value={f.relativeName}
          onChangeText={set('relativeName')}
        />
      </Card>
      <Card>
        <Field label={t('addressLine')} value={f.addressLine} onChangeText={set('addressLine')} />
        <Field label={`${t('area')} ${t('optional')}`} value={f.area} onChangeText={set('area')} />
        <Field label={t('district')} value={f.district} onChangeText={set('district')} />
        <Field
          label={t('pinCode')}
          value={f.pinCode}
          onChangeText={set('pinCode')}
          keyboardType="number-pad"
          maxLength={6}
        />
      </Card>
      <Card>
        <Field label={t('nomineeName')} value={f.nomineeName} onChangeText={set('nomineeName')} />
        <Field
          label={t('nomineeRelation')}
          value={f.nomineeRelation}
          onChangeText={set('nomineeRelation')}
        />
        <Field
          label={t('nomineePhone')}
          value={f.nomineePhone}
          onChangeText={set('nomineePhone')}
          keyboardType="phone-pad"
        />
      </Card>
      <Card>
        <Field
          label={t('vehicleRegistration')}
          value={f.registration}
          onChangeText={set('registration')}
          autoCapitalize="characters"
        />
        <Choice
          label={t('vehicleType')}
          value={vehicleType}
          onChange={setVehicleType}
          options={VEHICLE_TYPES.map((v) => ({ value: v, label: labels.vehicle[v] }))}
        />
        <Check label={t('ownsVehicle')} value={owns} onChange={setOwns} />
        {!owns && (
          <>
            <Field label={t('ownerName')} value={f.ownerName} onChangeText={set('ownerName')} />
            <Field
              label={t('ownerPhone')}
              value={f.ownerPhone}
              onChangeText={set('ownerPhone')}
              keyboardType="phone-pad"
            />
            <Muted>{t('ownerConsentNote')}</Muted>
          </>
        )}
      </Card>
      <ErrorNotice error={error} />
      {dups ? (
        <Card>
          <H2>
            {t('possibleDuplicate', {
              detail: dups.map((d) => `${d.detail}: ${d.driverName}`).join('; '),
            })}
          </H2>
          <Button
            title={t('saveAnyway')}
            variant="danger"
            busy={busy}
            onPress={() => void save(true)}
          />
          <Button title={t('cancel')} variant="secondary" onPress={() => setDups(null)} />
        </Card>
      ) : (
        <Button
          testID="save-driver"
          title={t('saveDriver')}
          busy={busy}
          // Needed for the "son / daughter / wife of" line of the agreement.
          disabled={!relation || f.relativeName.trim().length < 2 || dobInvalid}
          onPress={() => void save()}
        />
      )}
    </Screen>
  );
}

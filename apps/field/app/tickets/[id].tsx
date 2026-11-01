import { useState } from 'react';
import { Linking, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import {
  TICKET_OUTCOMES,
  type AgreementState,
  type TicketCategory,
  type TicketOutcome,
  type TicketStatus,
  type TicketTiming,
} from '@voltneo/shared';
import { BatteryPicker, type StockBattery } from '@/BatteryPicker';
import { hoursMinutes, shortDate } from '@/i18n';
import { appendPhotos, type Photo } from '@/photos';
import { useSession } from '@/session';
import { timingTone } from '@/tickets';
import {
  Badge,
  Body,
  Button,
  C,
  Card,
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

interface Ticket {
  id: string;
  number: string;
  driver: { name: string; phone: string };
  agreement: { id: string; number: string; state: AgreementState; batteryTypeId: string };
  batterySerial: string | null;
  category: TicketCategory;
  description: string;
  status: TicketStatus;
  timing: TicketTiming;
  reportedAt: string;
  dueBy: string;
  respondedAt: string | null;
  visits: {
    id: string;
    visitedAt: string;
    technicianName: string | null;
    voltageReading: string | null;
    finding: string;
  }[];
  replacements: { id: string; newBatterySerial: string | null }[];
  allowed: { visit: boolean; replace: boolean; resolve: boolean; resolveNeedsApproval: boolean };
  /** Founder, 1 Nov 2026: a close from the field waits for head office. */
  closeRejected: { reason: string } | null;
}

type Mode = 'none' | 'visit' | 'replace' | 'resolve';

export default function TicketPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, api, labels } = useSession();
  const {
    data: k,
    error,
    setData,
    loading,
    reload,
  } = useLoad(() => api.get<Ticket>(`/v1/tickets/${id}`), [api, id]);
  const [mode, setMode] = useState<Mode>('none');
  const [message, setMessage] = useState<string | null>(null);
  if (!k) {
    return (
      <Screen>
        <ErrorNotice error={error} />
        <Loading />
      </Screen>
    );
  }
  const left = new Date(k.dueBy).getTime() - Date.now();
  const finish = (updated: Ticket, text: string) => {
    setData(updated);
    setMode('none');
    setMessage(text);
  };
  return (
    <Screen onRefresh={() => void reload()} refreshing={loading}>
      <Stack.Screen options={{ title: k.number }} />
      <H1>{labels.ticketCategory[k.category]}</H1>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        <Badge tone={timingTone(k.timing)} text={labels.ticketTiming[k.timing]} />
        <Badge tone="plain" text={labels.ticketStatus[k.status]} />
      </View>
      {message && <Notice tone="success">{message}</Notice>}
      {k.status === 'CLOSE_REQUESTED' && !message && <Notice>{t('closeWaiting')}</Notice>}
      {k.closeRejected && (
        <Notice tone="warn">{t('closeSentBack', { reason: k.closeRejected.reason })}</Notice>
      )}
      <Card>
        <Body style={{ fontWeight: '700' }}>{k.driver.name}</Body>
        <Muted>
          {k.agreement.number} · {k.batterySerial}
        </Muted>
        <Button
          title={`${t('callDriver')} · ${k.driver.phone}`}
          variant="secondary"
          onPress={() => void Linking.openURL(`tel:${k.driver.phone}`)}
        />
        <Muted>{t('driverSays')}:</Muted>
        <Body>{k.description}</Body>
        <Muted>{t('reported', { time: shortDate(k.reportedAt, true) })}</Muted>
        <Muted>{t('respondBy', { time: shortDate(k.dueBy, true) })}</Muted>
        {!k.respondedAt && (
          <Body style={{ color: left < 0 ? C.danger : C.ink, fontWeight: '700' }}>
            {left >= 0
              ? t('hoursLeft', { time: hoursMinutes(left) })
              : t('hoursLate', { time: hoursMinutes(left) })}
          </Body>
        )}
      </Card>

      {mode === 'visit' ? (
        <VisitForm
          ticketId={k.id}
          onCancel={() => setMode('none')}
          onDone={(x) => finish(x, t('visitSaved'))}
        />
      ) : mode === 'replace' ? (
        <ReplaceForm
          ticket={k}
          onCancel={() => setMode('none')}
          onDone={(x) => finish(x, t('replaced'))}
        />
      ) : mode === 'resolve' ? (
        <ResolveForm
          ticket={k}
          onCancel={() => setMode('none')}
          onDone={(x) => finish(x, x.status === 'CLOSE_REQUESTED' ? t('closeSent') : t('resolved'))}
        />
      ) : (
        <>
          {k.allowed.visit && (
            <Button
              testID="record-visit"
              title={t('recordVisit')}
              onPress={() => setMode('visit')}
            />
          )}
          {k.allowed.replace && (
            <Button
              testID="replace-battery"
              title={t('replaceBattery')}
              variant="secondary"
              onPress={() => setMode('replace')}
            />
          )}
          {k.agreement.state === 'IMMOBILISED' && k.status === 'ASSIGNED' && (
            <Notice tone="warn">{t('disabledNoReplace')}</Notice>
          )}
          {k.allowed.resolve && (
            <Button
              testID="resolve"
              title={k.allowed.resolveNeedsApproval ? t('closeTicket') : t('resolve')}
              onPress={() => setMode('resolve')}
            />
          )}
        </>
      )}

      {k.visits.length > 0 && (
        <Card>
          <H2>{t('visits')}</H2>
          {k.visits.map((v) => (
            <View
              key={v.id}
              style={{ borderTopWidth: 1, borderTopColor: C.border, paddingVertical: 8 }}
            >
              <Muted>
                {shortDate(v.visitedAt, true)} · {v.technicianName}
                {v.voltageReading ? ` · ${v.voltageReading} V` : ''}
              </Muted>
              <Body>{v.finding}</Body>
            </View>
          ))}
        </Card>
      )}
    </Screen>
  );
}

function useSubmit(onDone: (t: Ticket) => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const run = (fn: () => Promise<Ticket>) =>
    void (async () => {
      setBusy(true);
      setError(null);
      try {
        onDone(await fn());
      } catch (err) {
        setError(err);
        setBusy(false);
      }
    })();
  return { busy, error, run };
}

function VisitForm({
  ticketId,
  onCancel,
  onDone,
}: {
  ticketId: string;
  onCancel: () => void;
  onDone: (t: Ticket) => void;
}) {
  const { t, api } = useSession();
  const [voltage, setVoltage] = useState('');
  const [readings, setReadings] = useState('');
  const [finding, setFinding] = useState('');
  const [photos, setPhotos] = useState<Photo[]>([]);
  const { busy, error, run } = useSubmit(onDone);
  return (
    <Card>
      <H2>{t('recordVisit')}</H2>
      <Muted>{t('visitIntro')}</Muted>
      <Field
        label={`${t('voltage')} ${t('optional')}`}
        value={voltage}
        onChangeText={(v) => setVoltage(v.replace(/[^\d.]/g, ''))}
        keyboardType="decimal-pad"
      />
      <Field
        label={`${t('otherReadings')} ${t('optional')}`}
        value={readings}
        onChangeText={setReadings}
      />
      <Field
        testID="finding"
        label={t('whatFound')}
        value={finding}
        onChangeText={setFinding}
        multiline
      />
      <Photos photos={photos} onChange={setPhotos} />
      <ErrorNotice error={error} />
      <Button
        testID="save-visit"
        title={t('save')}
        busy={busy}
        disabled={finding.trim().length < 3}
        onPress={() =>
          run(async () => {
            const form = new FormData();
            form.append('visitedAt', new Date().toISOString());
            if (voltage) form.append('voltageReading', voltage);
            if (readings.trim()) form.append('readingsNote', readings.trim());
            form.append('finding', finding.trim());
            await appendPhotos(form, 'photos', photos);
            return api.upload<Ticket>(`/v1/tickets/${ticketId}/visits`, form);
          })
        }
      />
      <Button title={t('cancel')} variant="secondary" onPress={onCancel} />
    </Card>
  );
}

function ReplaceForm({
  ticket,
  onCancel,
  onDone,
}: {
  ticket: Ticket;
  onCancel: () => void;
  onDone: (t: Ticket) => void;
}) {
  const { t, api } = useSession();
  const [battery, setBattery] = useState<StockBattery | null>(null);
  const [voltage, setVoltage] = useState('');
  const [note, setNote] = useState('');
  const [photos, setPhotos] = useState<Photo[]>([]);
  const { busy, error, run } = useSubmit(onDone);
  return (
    <Card>
      <H2>{t('replaceBattery')}</H2>
      <Muted>{t('replaceIntro')}</Muted>
      <BatteryPicker
        typeId={ticket.agreement.batteryTypeId}
        value={battery}
        onChange={setBattery}
      />
      <Field
        label={t('voltage')}
        value={voltage}
        onChangeText={(v) => setVoltage(v.replace(/[^\d.]/g, ''))}
        keyboardType="decimal-pad"
      />
      <Field label={t('oldBatteryNote')} value={note} onChangeText={setNote} multiline />
      <Photos photos={photos} onChange={setPhotos} />
      <ErrorNotice error={error} />
      <Button
        title={t('replaceBattery')}
        busy={busy}
        disabled={!battery || !(Number(voltage) > 0) || note.trim().length < 3}
        onPress={() =>
          run(async () => {
            const form = new FormData();
            form.append('newBatteryId', battery!.id);
            form.append('replacedAt', new Date().toISOString());
            form.append('voltageReading', voltage);
            form.append('oldBatteryNote', note.trim());
            await appendPhotos(form, 'photos', photos);
            return api.upload<Ticket>(`/v1/tickets/${ticket.id}/replacement`, form);
          })
        }
      />
      <Button title={t('cancel')} variant="secondary" onPress={onCancel} />
    </Card>
  );
}

function ResolveForm({
  ticket,
  onCancel,
  onDone,
}: {
  ticket: Ticket;
  onCancel: () => void;
  onDone: (t: Ticket) => void;
}) {
  const { t, api, labels } = useSession();
  const replaced = ticket.replacements.length > 0;
  const [outcome, setOutcome] = useState<TicketOutcome>(replaced ? 'REPLACED' : 'REPAIRED');
  const [resolution, setResolution] = useState('');
  const { busy, error, run } = useSubmit(onDone);
  const options = TICKET_OUTCOMES.filter((o) => (replaced ? o === 'REPLACED' : o !== 'REPLACED'));
  return (
    <Card>
      <H2>{ticket.allowed.resolveNeedsApproval ? t('closeTicket') : t('resolve')}</H2>
      <Choice
        label={t('outcome')}
        value={outcome}
        onChange={setOutcome}
        options={options.map((o) => ({ value: o, label: labels.ticketOutcome[o] }))}
      />
      <Field
        testID="resolution"
        label={t('whatWasDone')}
        value={resolution}
        onChangeText={setResolution}
        multiline
      />
      <ErrorNotice error={error} />
      <Button
        testID="save-resolve"
        title={ticket.allowed.resolveNeedsApproval ? t('closeTicket') : t('resolve')}
        busy={busy}
        disabled={resolution.trim().length < 3}
        onPress={() =>
          run(() =>
            api.post<Ticket>(`/v1/tickets/${ticket.id}/resolve`, {
              outcome,
              resolution: resolution.trim(),
            }),
          )
        }
      />
      <Button title={t('cancel')} variant="secondary" onPress={onCancel} />
    </Card>
  );
}

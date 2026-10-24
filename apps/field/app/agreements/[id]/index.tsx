import { useState } from 'react';
import { View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { randomUUID } from 'expo-crypto';
import type { AgreementState } from '@voltneo/shared';
import { rupees, shortDate } from '@/i18n';
import { parseRupees } from '@/money';
import { useSession } from '@/session';
import {
  Badge,
  Body,
  Button,
  Card,
  Check,
  ErrorNotice,
  Field,
  H1,
  H2,
  KV,
  Loading,
  Muted,
  Notice,
  Screen,
  useLoad,
} from '@/ui';

interface AgreementDetail {
  id: string;
  number: string;
  state: AgreementState;
  driver: { id: string; name: string; phone: string };
  vehicle: { registration: string | null };
  battery: { id: string; serial: string } | null;
  terms: { firstDueDate: string; totalPayable: number };
  money: {
    paid: number;
    outstanding: number;
    lateFeesDue: number;
    nextDue: { sequence: number; dueDate: string | null; amountLeft: number } | null;
  };
  schedule: { sequence: number; amount: number; amountPaid: number }[];
  allowed: { pay: boolean; install: boolean };
}

interface Link {
  id: string;
  amount: number;
  status: 'ACTIVE' | 'PAID' | 'EXPIRED' | 'CANCELLED';
  expiresAt: string;
  createdAt: string;
}

interface Links {
  gateway: 'cashfree' | 'fake' | 'none';
  items: Link[];
}

export default function AgreementPage() {
  const { id, done: doneFlag } = useLocalSearchParams<{ id: string; done?: string }>();
  const { t, api, labels, can } = useSession();
  const ag = useLoad(() => api.get<AgreementDetail>(`/v1/agreements/${id}`), [api, id]);
  const links = useLoad(() => api.get<Links>(`/v1/agreements/${id}/payment-links`), [api, id]);
  const [mode, setMode] = useState<'none' | 'cash' | 'link'>('none');
  const [message, setMessage] = useState<string | null>(
    doneFlag === 'installed' ? t('installed') : null,
  );
  const a = ag.data;
  const mayCollect = can('payments.collect_cash');

  if (!a) {
    return (
      <Screen>
        <ErrorNotice error={ag.error} />
        <Loading />
      </Screen>
    );
  }
  const dp = a.schedule.find((l) => l.sequence === 0);
  const owed =
    a.state === 'AWAITING_DOWN_PAYMENT'
      ? (dp?.amount ?? 0) - (dp?.amountPaid ?? 0)
      : a.money.outstanding + a.money.lateFeesDue;
  const open = links.data?.items.find((l) => l.status === 'ACTIVE');

  async function done(text: string) {
    setMode('none');
    setMessage(text);
    await Promise.all([ag.reload(), links.reload()]);
  }

  return (
    <Screen
      onRefresh={() => {
        void ag.reload();
        void links.reload();
      }}
      refreshing={ag.loading}
    >
      <Stack.Screen options={{ title: a.number }} />
      <H1>{t('agreement', { number: a.number })}</H1>
      <View style={{ flexDirection: 'row' }}>
        <Badge
          tone={a.state === 'IN_GRACE' || a.state === 'IMMOBILISED' ? 'danger' : 'info'}
          text={labels.state[a.state]}
        />
      </View>
      <Muted>
        {a.driver.name} · {a.driver.phone}
        {a.vehicle.registration ? ` · ${a.vehicle.registration}` : ''}
        {a.battery ? ` · ${a.battery.serial}` : ''}
      </Muted>
      {message && <Notice tone="success">{message}</Notice>}

      <Card>
        {a.state === 'AWAITING_DOWN_PAYMENT' ? (
          <KV k={t('downPaymentLeft')} v={rupees(owed)} strong />
        ) : (
          <>
            <KV k={t('stillToPay')} v={rupees(a.money.outstanding)} strong />
            <KV k={t('lateFeesDue')} v={rupees(a.money.lateFeesDue)} />
            {a.money.nextDue?.dueDate && (
              <Muted>
                {t('nextDue', {
                  amount: rupees(a.money.nextDue.amountLeft),
                  date: shortDate(a.money.nextDue.dueDate),
                })}
              </Muted>
            )}
          </>
        )}
      </Card>

      {a.allowed.install && can('installations.record') && (
        <Button
          testID="record-installation"
          title={t('recordInstallation')}
          onPress={() => router.push(`/agreements/${a.id}/install`)}
        />
      )}

      {a.allowed.pay && mayCollect ? (
        mode === 'cash' ? (
          <CashForm
            agreementId={a.id}
            max={owed}
            onCancel={() => setMode('none')}
            onDone={(text) => void done(text)}
          />
        ) : mode === 'link' ? (
          <LinkForm
            agreementId={a.id}
            max={owed}
            replaces={!!open}
            onCancel={() => setMode('none')}
            onDone={(text) => void done(text)}
          />
        ) : (
          <>
            <Button
              testID="collect-cash"
              title={t('collectCash')}
              onPress={() => {
                setMessage(null);
                setMode('cash');
              }}
            />
            {links.data && links.data.gateway !== 'none' && (
              <Button
                testID="send-link"
                title={t('sendUpiLink')}
                variant="secondary"
                onPress={() => {
                  setMessage(null);
                  setMode('link');
                }}
              />
            )}
          </>
        )
      ) : (
        !a.allowed.pay && a.state !== 'AWAITING_INSTALLATION' && <Muted>{t('noPaymentsNow')}</Muted>
      )}

      {links.data && (links.data.items.length > 0 || (mayCollect && a.allowed.pay)) && (
        <Card>
          <H2>{t('upiLinks')}</H2>
          {links.data.gateway === 'fake' && <Muted>{t('linksTestMode')}</Muted>}
          {links.data.gateway === 'none' && <Muted>{t('linksNotSetUp')}</Muted>}
          {links.data.items.slice(0, 5).map((l) => (
            <View key={l.id} style={{ gap: 6, paddingVertical: 6 }}>
              <Body>
                {rupees(l.amount)} · {shortDate(l.createdAt, true)}
              </Body>
              <View style={{ flexDirection: 'row' }}>
                <Badge
                  tone={l.status === 'PAID' ? 'success' : l.status === 'ACTIVE' ? 'info' : 'plain'}
                  text={labels.linkStatus[l.status]}
                />
              </View>
              {l.status === 'ACTIVE' && mayCollect && (
                <LinkActions link={l} onDone={(text) => void done(text)} />
              )}
            </View>
          ))}
        </Card>
      )}
      <Muted>{t('onlySystemReceipts')}</Muted>
    </Screen>
  );
}

function LinkActions({ link, onDone }: { link: Link; onDone: (text: string) => void }) {
  const { t, api } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const act = (path: string, text: string) =>
    void (async () => {
      setBusy(true);
      setError(null);
      try {
        await api.post(path);
        onDone(text);
      } catch (err) {
        setError(err);
      } finally {
        setBusy(false);
      }
    })();
  return (
    <>
      <Muted>
        {t('openLink', { amount: rupees(link.amount), date: shortDate(link.expiresAt, true) })}
      </Muted>
      <Button
        title={t('sendSmsAgain')}
        variant="secondary"
        busy={busy}
        onPress={() => act(`/v1/payment-links/${link.id}/resend`, t('smsSent'))}
      />
      <Button
        title={t('cancelLink')}
        variant="secondary"
        busy={busy}
        onPress={() => act(`/v1/payment-links/${link.id}/cancel`, t('linkCancelled'))}
      />
      <ErrorNotice error={error} />
    </>
  );
}

function CashForm({
  agreementId,
  max,
  onCancel,
  onDone,
}: {
  agreementId: string;
  max: number;
  onCancel: () => void;
  onDone: (text: string) => void;
}) {
  const { t, api } = useSession();
  const [text, setText] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  // One ID per form: a retry after a dropped connection is counted once.
  const [requestId] = useState(() => randomUUID());
  const amount = parseRupees(text);
  const valid = amount !== null && amount > 0 && amount <= max;
  return (
    <Card>
      <H2>{t('collectCash')}</H2>
      <Field
        testID="cash-amount"
        label={`${t('amount')} · ${t('upTo', { amount: rupees(max) })}`}
        value={text}
        onChangeText={(v) => {
          setText(v);
          setConfirmed(false);
        }}
        keyboardType="decimal-pad"
      />
      {valid && (
        <Check
          label={t('confirmCash', { amount: rupees(amount) })}
          value={confirmed}
          onChange={setConfirmed}
        />
      )}
      <ErrorNotice error={error} />
      <Button
        testID="record-cash"
        title={t('recordAmount', { amount: valid ? rupees(amount) : '' }).trim()}
        busy={busy}
        disabled={!valid || !confirmed}
        onPress={() =>
          void (async () => {
            setBusy(true);
            setError(null);
            try {
              const p = await api.post<{ receiptNumber: string; amount: number }>('/v1/payments', {
                agreementId,
                amountPaise: amount,
                method: 'CASH',
                clientRequestId: requestId,
              });
              onDone(t('receiptDone', { receipt: p.receiptNumber, amount: rupees(p.amount) }));
            } catch (err) {
              setError(err);
              setBusy(false);
            }
          })()
        }
      />
      <Button title={t('cancel')} variant="secondary" onPress={onCancel} />
    </Card>
  );
}

function LinkForm({
  agreementId,
  max,
  replaces,
  onCancel,
  onDone,
}: {
  agreementId: string;
  max: number;
  replaces: boolean;
  onCancel: () => void;
  onDone: (text: string) => void;
}) {
  const { t, api } = useSession();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const amount = parseRupees(text);
  const valid = amount !== null && amount >= 100 && amount <= max;
  return (
    <Card>
      <H2>{t('sendUpiLink')}</H2>
      <Field
        testID="link-amount"
        label={`${t('amount')} · ${t('upTo', { amount: rupees(max) })}`}
        value={text}
        onChangeText={setText}
        keyboardType="decimal-pad"
      />
      {replaces && <Muted>{t('linkReplaces')}</Muted>}
      <ErrorNotice error={error} />
      <Button
        testID="send-link-confirm"
        title={t('sendUpiLink')}
        busy={busy}
        disabled={!valid}
        onPress={() =>
          void (async () => {
            setBusy(true);
            setError(null);
            try {
              await api.post(`/v1/agreements/${agreementId}/payment-links`, {
                amountPaise: amount,
              });
              onDone(t('linkSent', { amount: rupees(amount!) }));
            } catch (err) {
              setError(err);
              setBusy(false);
            }
          })()
        }
      />
      <Button title={t('cancel')} variant="secondary" onPress={onCancel} />
    </Card>
  );
}

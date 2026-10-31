import { useState } from 'react';
import { Text, View } from 'react-native';
import { rupees, shortDate } from '@/i18n';
import { openPage, openPdf } from '@/pdf';
import { useSession } from '@/session';
import type { MyAgreement } from '@/types';
import { Badge, Button, C, Card, ErrorNotice, H2, KV, Loading, Muted, Screen, useLoad } from '@/ui';

export default function Agreement() {
  const { t, api, labels } = useSession();
  const {
    data: a,
    error,
    loading,
    reload,
  } = useLoad(() => api.get<MyAgreement>('/v1/me/agreement'), [api]);
  const [busy, setBusy] = useState<string | null>(null);
  const [docError, setDocError] = useState<unknown>(null);

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key);
    setDocError(null);
    try {
      await fn();
    } catch (err) {
      setDocError(err);
    } finally {
      setBusy(null);
    }
  }

  const today = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
  return (
    <Screen onRefresh={() => void reload()} refreshing={loading && !!a}>
      {loading && !a && <Loading />}
      <ErrorNotice error={error} />
      {a && (
        <>
          <Card>
            <H2>{t('agreementNo', { number: a.number })}</H2>
            <Badge text={labels.state[a.state]} tone="plain" />
            <KV k={t('plan')} v={a.plan.name} />
            <KV k={t('battery')} v={a.battery.type} />
            {a.battery.serial && <KV k={t('serial')} v={a.battery.serial} />}
            {a.vehicle.registration && <KV k={t('vehicle')} v={a.vehicle.registration} />}
          </Card>
          <Card>
            <KV k={t('downPayment')} v={rupees(a.money.downPayment)} />
            <KV k={t('instalment')} v={rupees(a.money.instalment)} />
            <KV k={t('instalments')} v={a.money.termMonths} />
            <KV k={t('dueDay')} v={t('dueDayValue', { day: a.money.dueDay })} />
            <KV k={t('total')} v={rupees(a.money.totalPayable)} strong />
            <KV k={t('paidSoFar')} v={rupees(a.money.paid)} />
            {a.money.lateFeesDue > 0 && <KV k={t('lateFees')} v={rupees(a.money.lateFeesDue)} />}
          </Card>
          <Card>
            <H2>{t('schedule')}</H2>
            {a.schedule.map((l) => {
              const paid = l.status === 'PAID';
              const late = !paid && !!l.dueDate && l.dueDate < today;
              return (
                <View
                  key={l.sequence}
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    paddingVertical: 6,
                    borderTopWidth: l.sequence === 0 ? 0 : 1,
                    borderTopColor: C.border,
                  }}
                >
                  <View>
                    <Text style={{ fontSize: 15, color: C.ink }}>
                      {l.sequence === 0
                        ? t('downPaymentRow')
                        : t('instalmentRow', { n: l.sequence })}
                    </Text>
                    {l.dueDate && <Muted>{shortDate(l.dueDate)}</Muted>}
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text
                      style={{ fontSize: 15, fontWeight: '700', color: late ? C.danger : C.ink }}
                    >
                      {rupees(l.amount)}
                    </Text>
                    <Text
                      style={{ fontSize: 13, color: paid ? C.success : late ? C.danger : C.muted }}
                    >
                      {paid ? '✓' : l.amountPaid > 0 ? rupees(l.amountPaid) : ''}
                    </Text>
                  </View>
                </View>
              );
            })}
          </Card>
          <ErrorNotice error={docError} />
          <Button
            title={t('keyFacts')}
            variant="secondary"
            busy={busy === 'kf'}
            onPress={() =>
              void run('kf', () =>
                openPdf(api, `/v1/me/agreements/${a.id}/key-facts`, `${a.number}-key-facts.pdf`),
              )
            }
          />
          <Button
            title={t('scheduleDoc')}
            variant="secondary"
            busy={busy === 'sc'}
            onPress={() =>
              void run('sc', () =>
                openPdf(api, `/v1/me/agreements/${a.id}/schedule`, `${a.number}-schedule.pdf`),
              )
            }
          />
          {a.documents.signedCopy ? (
            <Button
              title={t('signedCopy')}
              variant="secondary"
              busy={busy === 'sg'}
              onPress={() =>
                void run('sg', async () => {
                  const r = await api.get<{ url: string }>(`/v1/me/agreements/${a.id}/signed-copy`);
                  await openPage(`${api.baseUrl}${r.url}`);
                })
              }
            />
          ) : (
            <Muted>{t('notUploaded')}</Muted>
          )}
        </>
      )}
    </Screen>
  );
}

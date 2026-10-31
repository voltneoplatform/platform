import { useState } from 'react';
import { TICKET_CATEGORIES, type TicketCategory } from '@voltneo/shared';
import { ApiError } from '@/api';
import { shortDate } from '@/i18n';
import { useSession } from '@/session';
import type { MyAgreement, MyTicket } from '@/types';
import {
  Badge,
  Button,
  Card,
  Choice,
  ErrorNotice,
  Field,
  H2,
  Loading,
  Muted,
  Notice,
  Screen,
  useLoad,
} from '@/ui';

const SERVICEABLE = ['ACTIVE', 'IN_GRACE', 'IMMOBILISED'];

export default function Help() {
  const { t, api, labels } = useSession();
  const tickets = useLoad(() => api.get<MyTicket[]>('/v1/me/tickets'), [api]);
  const agreement = useLoad(() => api.get<MyAgreement>('/v1/me/agreement'), [api]);
  const [category, setCategory] = useState<TicketCategory | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [sent, setSent] = useState<string | null>(null);

  const a = agreement.data;
  const open = tickets.data?.find((x) => x.status === 'OPEN' || x.status === 'ASSIGNED');

  async function send() {
    if (!a || !category) return;
    setBusy(true);
    setError(null);
    try {
      const list = await api.post<MyTicket[]>('/v1/me/tickets', {
        agreementId: a.id,
        category,
        description: text.trim(),
      });
      tickets.setData(list);
      setSent(list[0]?.number ?? null);
      setCategory(null);
      setText('');
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === 'TICKET_OPEN' && open
          ? new ApiError(409, t('requestOpen', { number: open.number }))
          : err,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen
      onRefresh={() => {
        void tickets.reload();
        void agreement.reload();
      }}
      refreshing={tickets.loading && !!tickets.data}
    >
      {(tickets.loading || agreement.loading) && !tickets.data && <Loading />}
      <ErrorNotice error={agreement.error ?? tickets.error} />
      {sent && <Notice tone="success">{t('sent', { number: sent })}</Notice>}
      {a && !SERVICEABLE.includes(a.state) ? (
        ['PAID_OFF', 'EARLY_EXIT', 'TRANSFERRED'].includes(a.state) && (
          <Notice>{t('serviceEnded')}</Notice>
        )
      ) : open ? (
        <Notice tone="warn">{t('requestOpen', { number: open.number })}</Notice>
      ) : (
        a && (
          <Card>
            <H2>{t('reportTitle')}</H2>
            <Choice
              label={t('whatProblem')}
              value={category}
              onChange={setCategory}
              options={TICKET_CATEGORIES.map((c) => ({ value: c, label: labels.category[c] }))}
            />
            <Field
              label={t('describe')}
              placeholder={t('describeHint')}
              value={text}
              onChangeText={setText}
              multiline
              maxLength={1000}
            />
            <ErrorNotice error={error} />
            <Button
              testID="send-ticket"
              title={t('send')}
              busy={busy}
              disabled={!category || text.trim().length < 5}
              onPress={() => void send()}
            />
          </Card>
        )
      )}
      <H2>{t('myRequests')}</H2>
      {tickets.data?.length === 0 && <Muted>{t('noRequests')}</Muted>}
      {tickets.data?.map((x) => (
        <Card key={x.id}>
          <H2>{labels.category[x.category]}</H2>
          <Badge
            text={labels.ticket[x.status]}
            tone={x.status === 'RESOLVED' ? 'success' : x.status === 'CANCELLED' ? 'plain' : 'warn'}
          />
          <Muted>
            {t('requestNo', { number: x.number })} ·{' '}
            {t('reported', { date: shortDate(x.reportedAt) })}
          </Muted>
          <Muted>{x.description}</Muted>
        </Card>
      ))}
    </Screen>
  );
}

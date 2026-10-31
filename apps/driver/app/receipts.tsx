import { useState } from 'react';
import { rupees, shortDate } from '@/i18n';
import { openPdf } from '@/pdf';
import { useSession } from '@/session';
import type { Receipt } from '@/types';
import { Button, Card, ErrorNotice, H2, Loading, Muted, Screen, useLoad } from '@/ui';

export default function Receipts() {
  const { t, api, labels } = useSession();
  const { data, error, loading, reload } = useLoad(
    () => api.get<Receipt[]>('/v1/me/payments'),
    [api],
  );
  const [opening, setOpening] = useState<string | null>(null);
  const [openError, setOpenError] = useState<unknown>(null);

  async function open(r: Receipt) {
    setOpening(r.id);
    setOpenError(null);
    try {
      await openPdf(api, `/v1/me/payments/${r.id}/receipt`, `receipt-${r.receiptNumber}.pdf`);
    } catch (err) {
      setOpenError(err);
    } finally {
      setOpening(null);
    }
  }

  return (
    <Screen onRefresh={() => void reload()} refreshing={loading && !!data}>
      {loading && !data && <Loading />}
      <ErrorNotice error={error ?? openError} />
      {data?.length === 0 && <Muted>{t('noReceipts')}</Muted>}
      {data?.map((r) => (
        <Card key={r.id}>
          <H2>{rupees(r.amount)}</H2>
          <Muted>
            {shortDate(r.receivedAt, true)} · {t('paidBy', { method: labels.method[r.method] })}
          </Muted>
          <Muted>{t('receiptNo', { number: r.receiptNumber })}</Muted>
          <Muted>{t('balanceAfter', { amount: rupees(r.balanceAfter) })}</Muted>
          <Button
            title={t('openReceipt')}
            variant="secondary"
            busy={opening === r.id}
            onPress={() => void open(r)}
          />
        </Card>
      ))}
    </Screen>
  );
}

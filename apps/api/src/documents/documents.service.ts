import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  AGREEMENT_DOCUMENT_IS_DRAFT,
  RECOVERY_AFTER_DAYS,
  SERVICE_RESPONSE_HOURS,
  amountInWords,
  formatRupees,
  type ScheduleLine,
} from '@voltneo/shared';
import { Pdf } from './pdf';
import { TEXTS, docDate, type Lang } from './texts';

export interface AgreementDocData {
  number: string;
  signed: boolean;
  documentVersion: string;
  scheduleRevision: number;
  driver: { name: string; phone: string };
  vehicle: { identifier: string };
  plan: { code: string; version: number; names: Record<Lang, string> };
  batteryType: { name: string; voltage: string; capacityAh: string };
  downPayment: number;
  instalment: number;
  termMonths: number;
  totalPayable: number;
  dueDay: number;
  firstDueDate: string;
  lastDueDate: string;
  graceDays: number;
  lateFeePerDayPaise: number;
  lateFeeCapDays: number;
  nominee: { name: string | null; relation: string | null; phone: string | null };
  lines: readonly ScheduleLine[];
}

export interface ReceiptDocData {
  receiptNumber: string;
  receivedAt: Date;
  agreementNumber: string;
  driverName: string;
  amount: number;
  method: string;
  reference: string | null;
  collectedByName: string | null;
  allocations: readonly {
    kind: 'LATE_FEE' | 'DOWN_PAYMENT' | 'INSTALMENT' | 'EXCESS';
    amount: number;
    sequence?: number | null;
    date?: string | null;
  }[];
  balanceAfter: number;
}

export type ScheduleDoc = 'schedule-1' | 'schedule-5';
export const SCHEDULE_DOCS: readonly ScheduleDoc[] = ['schedule-1', 'schedule-5'];

const rupees = (p: number) => formatRupees(p);

/** Date and time in India, e.g. 23/10/2026 14:05. */
function istDateTime(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
  return parts.replace(',', '');
}

/**
 * A short fingerprint of the figures on a document, printed in its footer, so
 * a signed paper copy can be matched to the system record.
 */
export function documentFingerprint(data: AgreementDocData): string {
  const h = createHash('sha256')
    .update(
      JSON.stringify([
        data.number,
        data.documentVersion,
        data.scheduleRevision,
        data.plan.code,
        data.plan.version,
        data.downPayment,
        data.instalment,
        data.termMonths,
        data.totalPayable,
        data.lines.map((l) => [l.sequence, l.dueDate, l.amount]),
      ]),
    )
    .digest('hex')
    .slice(0, 12)
    .toUpperCase();
  return `${h.slice(0, 4)}-${h.slice(4, 8)}-${h.slice(8)}`;
}

@Injectable()
export class DocumentsService {
  private banners(pdf: Pdf, lang: Lang, signed: boolean) {
    const t = TEXTS[lang];
    if (AGREEMENT_DOCUMENT_IS_DRAFT) {
      pdf.banner(
        lang === 'EN' ? t.draftBanner : `${t.draftBanner}\n${TEXTS.EN.draftBanner}`,
        'warn',
      );
    }
    if (!signed) pdf.banner(t.previewBanner, 'info');
  }

  private footer(data: AgreementDocData, lang: Lang) {
    const ref = documentFingerprint(data);
    return (page: number, of: number) => ({
      left: `${data.number} · ${data.documentVersion} · rev ${data.scheduleRevision} · ref ${ref}`,
      right: TEXTS[lang].page(page, of),
    });
  }

  async schedule(doc: ScheduleDoc, data: AgreementDocData, lang: Lang): Promise<Buffer> {
    return doc === 'schedule-1' ? this.schedule1(data, lang) : this.schedule5(data, lang);
  }

  async schedule1(data: AgreementDocData, lang: Lang): Promise<Buffer> {
    const t = TEXTS[lang];
    const pdf = new Pdf(lang, {
      title: `${data.number} ${TEXTS.EN.schedule1Title}`,
      createdAt: new Date(),
    });
    pdf.brand(t.schedule1Title, `${t.agreementNo}: ${data.number}`);
    this.banners(pdf, lang, data.signed);

    const nominee = [data.nominee.name, data.nominee.relation, data.nominee.phone]
      .filter(Boolean)
      .join(', ');
    pdf.rows([
      [t.driver, `${data.driver.name}, ${t.phone} ${data.driver.phone}`],
      [t.vehicle, data.vehicle.identifier],
      [t.plan, t.planValue(data.plan.names[lang], data.plan.code, data.plan.version)],
      [
        t.batteryType,
        `${data.batteryType.name} (${data.batteryType.voltage} V, ${data.batteryType.capacityAh} Ah)`,
      ],
      [t.downPayment, `${rupees(data.downPayment)}\n${amountInWords(data.downPayment, lang)}`],
      [t.monthlyInstalment, rupees(data.instalment)],
      [t.numberOfInstalments, String(data.termMonths)],
      [t.totalPayable, `${rupees(data.totalPayable)}\n${amountInWords(data.totalPayable, lang)}`],
      [t.dueDate, t.dueDateValue(data.dueDay)],
      [t.firstDueDate, docDate(data.firstDueDate)],
      [t.lastDueDate, docDate(data.lastDueDate)],
      [
        t.lateFee,
        t.lateFeeValue(rupees(data.lateFeePerDayPaise), data.graceDays, data.lateFeeCapDays),
      ],
      [t.gst, t.gstValue],
      [t.nominee, nominee],
    ]);

    pdf.sectionTitle(t.paymentTable);
    pdf.table(
      [
        { title: t.colNumber, share: 0.14 },
        { title: t.colDueDate, share: 0.5 },
        { title: t.colAmount, share: 0.36, align: 'right' },
      ],
      data.lines.map((l) =>
        l.sequence === 0
          ? [t.downPaymentRow, t.beforeInstallation, rupees(l.amount)]
          : [String(l.sequence), docDate(l.dueDate!), rupees(l.amount)],
      ),
    );

    pdf.signatures([
      { label: t.driverSignature, sub: t.date },
      { label: t.forVoltNeo, sub: `${t.nameAndId} · ${t.date}` },
    ]);
    return pdf.finish(this.footer(data, lang));
  }

  async schedule5(data: AgreementDocData, lang: Lang): Promise<Buffer> {
    const t = TEXTS[lang];
    const pdf = new Pdf(lang, {
      title: `${data.number} ${TEXTS.EN.schedule5Title}`,
      createdAt: new Date(),
    });
    pdf.brand(t.schedule5Title, `${t.agreementNo}: ${data.number} · ${data.driver.name}`);
    this.banners(pdf, lang, data.signed);
    pdf.note(t.k5Intro);
    const fee = rupees(data.lateFeePerDayPaise);
    pdf.rows(
      [
        [t.k5PayNow, rupees(data.downPayment)],
        [
          t.k5PayMonthly,
          t.k5PayMonthlyValue(rupees(data.instalment), data.dueDay, data.termMonths),
        ],
        [t.k5Total, rupees(data.totalPayable)],
        [t.k5Yours, t.k5YoursValue(docDate(data.lastDueDate))],
        [t.k5Late, t.k5LateValue(data.graceDays, fee, data.lateFeeCapDays)],
        [t.k5NoPay, t.k5NoPayValue(RECOVERY_AFTER_DAYS)],
        [t.k5Early, t.k5EarlyValue],
        [t.k5Cannot, t.k5CannotValue],
        [t.k5Stolen, t.k5StolenValue],
        [t.k5Repair, t.k5RepairValue(SERVICE_RESPONSE_HOURS)],
      ],
      0.36,
      10.5,
    );
    pdf.doc.moveDown(1);
    pdf.doc.font('bold').fontSize(10.5).text(t.k5Confirm(t.languageName[lang]));
    pdf.signatures([
      { label: t.driverSignature, sub: t.date },
      { label: t.k5ExplainedBy, sub: t.date },
    ]);
    return pdf.finish(this.footer(data, lang));
  }

  async receipt(data: ReceiptDocData, lang: Lang): Promise<Buffer> {
    const t = TEXTS[lang];
    const pdf = new Pdf(lang, { title: `Receipt ${data.receiptNumber}`, createdAt: new Date() });
    pdf.brand(t.receiptTitle, `${t.receiptNo}: ${data.receiptNumber}`);
    const towards = data.allocations.map((a) => {
      const label =
        a.kind === 'DOWN_PAYMENT'
          ? t.allocDownPayment
          : a.kind === 'INSTALMENT'
            ? t.allocInstalment(a.sequence ?? 0, a.date ? docDate(a.date) : '')
            : a.kind === 'LATE_FEE'
              ? t.allocLateFee(a.date ? docDate(a.date) : '')
              : t.allocExcess;
      return `${label}: ${rupees(a.amount)}`;
    });
    pdf.rows([
      [t.receiptNo, data.receiptNumber],
      [t.receivedAt, istDateTime(data.receivedAt)],
      [t.driver, data.driverName],
      [t.agreementNo, data.agreementNumber],
      [t.amountReceived, `${rupees(data.amount)}\n${amountInWords(data.amount, lang)}`],
      [t.method, data.method],
      ...(data.reference ? [[t.reference, data.reference] as const] : []),
      ...(data.collectedByName ? [[t.collectedBy, data.collectedByName] as const] : []),
      [t.paidTowards, towards.join('\n')],
      [t.balanceAfter, rupees(data.balanceAfter)],
    ]);
    pdf.doc.moveDown(0.8);
    pdf.note(t.receiptValidity);
    return pdf.finish((page, of) => ({
      left: `Volt Neo · ${data.receiptNumber}`,
      right: t.page(page, of),
    }));
  }
}

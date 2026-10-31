import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  AGREEMENT_DOCUMENT_IS_DRAFT,
  COMPANY,
  RECOVERY_AFTER_DAYS,
  SERVICE_RESPONSE_HOURS,
  amountInWords,
  formatRupees,
  type ScheduleLine,
} from '@voltneo/shared';
import { AgreementPdf } from './agreement-pdf';
import { SCHEDULE6_PROVIDERS, agreementParts, schedule6 } from './agreement-text';
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

/** What the full printed agreement adds to the schedule data. */
export interface AgreementPackData extends AgreementDocData {
  party: {
    name: string;
    /** Whole years at the document date; null when no date of birth is recorded. */
    age: number | null;
    address: string;
    phone: string;
    /** "son of", "daughter of" or "wife of" and the name; null leaves a blank to fill in. */
    relative: { relation: string; name: string } | null;
    /** Identity document, with only its last four characters (UIDAI masking rules). */
    id: { label: string; last4: string } | null;
  };
  vehicleDetail: {
    type: string;
    registration: string | null;
    chassis: string | null;
    ownedByDriver: boolean;
    ownerName: string | null;
    ownerPhone: string | null;
  };
  batteryDetail: { chemistry: string; serial: string | null };
  driverLanguage: Lang;
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

export interface CertificateDocData {
  certificateNumber: string;
  driverName: string;
  agreementNumber: string;
  agreementDate: string;
  batteryType: string;
  serial: string;
  totalPayable: number;
  paidInFullOn: string;
  transferredOn: string;
  gpsOffOn: string;
}

export type ScheduleDoc = 'schedule-1' | 'schedule-5';
export const SCHEDULE_DOCS: readonly ScheduleDoc[] = ['schedule-1', 'schedule-5'];
/** The full agreement for printing, its first page on stamp paper (founder, 31 Oct 2026). */
export const AGREEMENT_DOC = 'agreement';

const LANGUAGE_NAMES: Record<Lang, string> = { BN: 'Bengali', HI: 'Hindi', EN: 'English' };

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
        t.lateFeeValue(
          rupees(data.lateFeePerDayPaise),
          data.graceDays,
          data.lateFeeCapDays,
          rupees(data.lateFeePerDayPaise * data.lateFeeCapDays),
        ),
      ],
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
        [
          t.k5Late,
          t.k5LateValue(
            data.graceDays,
            fee,
            data.lateFeeCapDays,
            rupees(data.lateFeePerDayPaise * data.lateFeeCapDays),
          ),
        ],
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

  /**
   * The whole agreement in English (founder, 31 Oct 2026), for printing with its
   * first page on stamp paper: the top half of page 1 is left blank, both
   * parties initial every page, and the schedules carry this driver's figures.
   */
  async agreement(data: AgreementPackData): Promise<Buffer> {
    const t = TEXTS.EN;
    const ref = documentFingerprint(data);
    const pdf = new AgreementPdf(
      `${data.number} Neo Own Agreement`,
      AGREEMENT_DOCUMENT_IS_DRAFT ? t.draftBanner : null,
    );
    const blank = (n: number) => '_'.repeat(n);

    pdf.title('NEO OWN AGREEMENT', `Agreement number ${data.number} · ${data.documentVersion}`);
    pdf.para(
      `This Agreement is made at ${blank(22)} on this ${blank(6)} day of ${blank(16)}, 20${blank(4)}.`,
    );
    pdf.centered('BETWEEN');
    pdf.para([
      { text: COMPANY.legalName.toUpperCase(), bold: true },
      {
        text:
          `, a company incorporated under the Companies Act, 2013, with Corporate Identity Number ${COMPANY.cin ?? blank(21)}, PAN ${COMPANY.pan} and GSTIN ${COMPANY.gstin}, ` +
          `having its registered office at ${COMPANY.address}, carrying on business under the brand name "Volt Neo", ` +
          `acting through its authorised signatory ${blank(24)} ` +
          '(called "Volt Neo" in this agreement, which includes its successors and permitted assigns), of the ONE PART;',
      },
    ]);
    pdf.centered('AND');
    const p = data.party;
    pdf.para([
      { text: p.name.toUpperCase(), bold: true },
      {
        text:
          `, ${p.relative ? `${p.relative.relation} ${p.relative.name}` : `son / daughter / wife of ${blank(24)}`}, aged ${p.age === null ? `${blank(4)}` : `about ${p.age}`} years, ` +
          `residing at ${p.address}, mobile ${p.phone}, ` +
          (p.id
            ? `holding ${p.id.label} number ending ${p.id.last4} `
            : `holding ${blank(14)} number ${blank(14)} `) +
          '(called "you" or "the Driver" in this agreement), of the OTHER PART.',
      },
    ]);
    pdf.para('Volt Neo and you are together called the "parties". The parties agree as follows.');

    pdf.parts(
      agreementParts({
        graceDays: data.graceDays,
        lateFee: rupees(data.lateFeePerDayPaise),
        lateFeeCapDays: data.lateFeeCapDays,
        lateFeeCap: rupees(data.lateFeePerDayPaise * data.lateFeeCapDays),
        recoveryAfterDays: RECOVERY_AFTER_DAYS,
        serviceHours: SERVICE_RESPONSE_HOURS,
        headOfficeAddress: COMPANY.address,
      }),
    );

    // --- Signatures: kept together on one page ------------------------------------
    pdf.ensure(560);
    pdf.heading('SIGNATURES');
    pdf.para(
      'IN WITNESS WHEREOF the parties have signed this agreement on the date and at the place first written above.',
    );
    pdf.signatureBoxes([
      {
        heading: `For ${COMPANY.legalName} (Volt Neo)`,
        lines: ['Signature and company seal', 'Name of authorised signatory', 'Designation'],
      },
      {
        heading: `The Driver: ${p.name}`,
        lines: ['Signature', 'Date'],
        thumb: true,
      },
    ]);
    pdf.para(
      `Explained to the Driver in ${blank(18)} (Bengali / Hindi / English) by the Volt Neo staff member below, before signing. The Driver's preferred language is ${LANGUAGE_NAMES[data.driverLanguage]}.`,
    );
    pdf.signatureBoxes([
      { heading: 'Explained by', lines: ['Signature', 'Name and staff ID'] },
      { heading: '', lines: [] },
    ]);
    pdf.signatureBoxes([
      { heading: 'Witness 1', lines: ['Signature', 'Name', 'Address'] },
      { heading: 'Witness 2', lines: ['Signature', 'Name', 'Address'] },
    ]);

    // --- Schedules -----------------------------------------------------------------
    pdf.newPage();
    pdf.heading('SCHEDULE 1: YOUR PLAN');
    const nominee = [data.nominee.name, data.nominee.relation, data.nominee.phone]
      .filter(Boolean)
      .join(', ');
    pdf.rows([
      [t.plan, t.planValue(data.plan.names.EN, data.plan.code, data.plan.version)],
      [
        t.batteryType,
        `${data.batteryType.name} (${data.batteryType.voltage} V, ${data.batteryType.capacityAh} Ah)`,
      ],
      [t.downPayment, `${rupees(data.downPayment)}\n${amountInWords(data.downPayment, 'EN')}`],
      [t.monthlyInstalment, rupees(data.instalment)],
      [t.numberOfInstalments, String(data.termMonths)],
      [t.totalPayable, `${rupees(data.totalPayable)}\n${amountInWords(data.totalPayable, 'EN')}`],
      [t.dueDate, t.dueDateValue(data.dueDay)],
      [t.firstDueDate, docDate(data.firstDueDate)],
      [t.lastDueDate, docDate(data.lastDueDate)],
      [
        t.lateFee,
        t.lateFeeValue(
          rupees(data.lateFeePerDayPaise),
          data.graceDays,
          data.lateFeeCapDays,
          rupees(data.lateFeePerDayPaise * data.lateFeeCapDays),
        ),
      ],
      [`${t.nominee} (clause E11)`, nominee],
    ]);
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

    pdf.heading('SCHEDULE 2: BATTERY AND GPS DETAILS');
    pdf.rows([
      ['Battery type', data.batteryType.name],
      ['Voltage and capacity', `${data.batteryType.voltage} V, ${data.batteryType.capacityAh} Ah`],
      ['Chemistry', data.batteryDetail.chemistry],
      ['Serial number', data.batteryDetail.serial ?? 'Recorded at installation (Schedule 3)'],
      ['GPS Module', 'Recorded at installation (Schedule 3)'],
      [
        'Replacement history',
        "Recorded in Volt Neo's system if the Battery is replaced (clause C8)",
      ],
    ]);

    const v = data.vehicleDetail;
    pdf.heading('SCHEDULE 3: VEHICLE AND INSTALLATION');
    pdf.rows([
      ['Vehicle type', v.type],
      ['Registration number', v.registration ?? 'Not registered'],
      ['Chassis number', v.chassis ?? '—'],
      [
        'Vehicle owner',
        v.ownedByDriver
          ? 'The Driver'
          : `${v.ownerName ?? blank(20)}${v.ownerPhone ? `, ${v.ownerPhone}` : ''} (signs Schedule 7)`,
      ],
      [
        'Installation',
        "Recorded by the Volt Neo technician at installation, with the Battery's condition, test readings and photos, and confirmed by the Driver (clause C2).",
      ],
    ]);

    pdf.heading('SCHEDULE 4: IF A PAYMENT IS MISSED');
    const fee = rupees(data.lateFeePerDayPaise);
    pdf.table(
      [
        { title: 'When', share: 0.38 },
        { title: 'What happens', share: 0.62 },
      ],
      [
        ['5, 3 and 1 day before your Due Date, and on it', 'Volt Neo sends you a reminder'],
        [`Days 1–${data.graceDays} after your Due Date`, 'Grace Period: no Late Fee'],
        [`Day ${data.graceDays}`, 'Final notice, in writing and by voice call'],
        [
          `Day ${data.graceDays + 1}, if still unpaid`,
          `Battery disabled when the vehicle is stationary; Late Fee of ${fee} per day begins (for at most ${data.lateFeeCapDays} days each time you are late)`,
        ],
        ['Any time you pay all you owe', 'Battery re-enabled; no reconnection fee'],
        [
          `${RECOVERY_AFTER_DAYS} days after the Battery is disabled, if still unpaid`,
          'Battery collected; Down Payment and paid Instalments kept; account closed; no further amounts asked for',
        ],
      ],
    );
    pdf.signatureBoxes([
      {
        heading: 'Driver: this Schedule was explained to me',
        lines: ['Signature or thumb impression'],
      },
      { heading: '', lines: [] },
    ]);

    pdf.heading('SCHEDULE 5: KEY FACTS');
    pdf.para(
      `The Key Facts summary is a separate page, printed in ${LANGUAGE_NAMES[data.driverLanguage]} (or the language the Driver chooses), read aloud and signed by the Driver before this agreement is signed.`,
    );

    pdf.ensure(300);
    pdf.heading('SCHEDULE 6: YOUR INFORMATION AND GPS TRACKING');
    pdf.blocks(schedule6(SCHEDULE6_PROVIDERS));
    pdf.signatureBoxes([
      { heading: 'Driver', lines: ['Signature or thumb impression', 'Date'] },
      { heading: '', lines: [] },
    ]);

    if (!v.ownedByDriver) {
      pdf.ensure(330);
      pdf.heading("SCHEDULE 7: VEHICLE OWNER'S CONSENT");
      pdf.para(
        `I, ${v.ownerName ?? blank(24)}, of ${blank(40)}, owner of vehicle ${v.registration ?? v.chassis ?? blank(14)}, consent to:`,
      );
      pdf.list(
        [
          `Volt Neo installing its Battery and GPS Module in my vehicle for use by ${p.name};`,
          "Volt Neo tracking the Battery's location and disabling the Battery remotely under the driver's agreement; and",
          "Volt Neo's staff having reasonable access to my vehicle to service, replace or recover the Battery.",
        ],
        true,
      );
      pdf.para(
        "I understand the Battery belongs to Volt Neo until the driver has paid for it, and that I am not responsible for the driver's payments.",
      );
      pdf.signatureBoxes([
        {
          heading: 'Vehicle owner',
          lines: ['Signature', 'ID type and number', 'Date'],
          thumb: true,
        },
        { heading: '', lines: [] },
      ]);
    }

    pdf.heading('SCHEDULE 8: OWNERSHIP TRANSFER CERTIFICATE');
    pdf.para('Issued by Volt Neo when the Battery becomes yours (clause E9).');

    return pdf.finish(
      `Neo Own Agreement ${data.number} · ${data.documentVersion} · rev ${data.scheduleRevision} · ref ${ref}`,
    );
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

  /**
   * Schedule 8: Ownership Transfer Certificate (clause E9), signed for the
   * company behind the brand (L14).
   */
  async certificate(data: CertificateDocData, lang: Lang): Promise<Buffer> {
    const t = TEXTS[lang];
    const pdf = new Pdf(lang, {
      title: `${data.certificateNumber} ${TEXTS.EN.certificateTitle}`,
      createdAt: new Date(),
    });
    pdf.brand(t.certificateTitle, `${t.certificateNo}: ${data.certificateNumber}`);
    if (AGREEMENT_DOCUMENT_IS_DRAFT) {
      pdf.banner(
        lang === 'EN' ? t.draftBanner : `${t.draftBanner}\n${TEXTS.EN.draftBanner}`,
        'warn',
      );
    }
    pdf.paragraph(
      t.certificateBody({
        driver: data.driverName,
        agreement: data.agreementNumber,
        agreementDate: docDate(data.agreementDate),
        serial: data.serial,
        transferDate: docDate(data.transferredOn),
        gpsOffDate: docDate(data.gpsOffOn),
      }),
    );
    pdf.rows([
      [t.certificateNo, data.certificateNumber],
      [t.driver, data.driverName],
      [t.agreementNo, data.agreementNumber],
      [t.agreementDate, docDate(data.agreementDate)],
      [t.battery, `${data.serial} (${data.batteryType})`],
      [t.totalPaid, `${rupees(data.totalPayable)}\n${amountInWords(data.totalPayable, lang)}`],
      [t.paidInFullOn, docDate(data.paidInFullOn)],
      [t.ownershipPassedOn, docDate(data.transferredOn)],
      [t.gpsOffOn, docDate(data.gpsOffOn)],
    ]);
    pdf.doc.moveDown(0.8);
    pdf.note(t.certificateKeep);
    pdf.signatures([{ label: t.forVoltNeo, sub: t.authorisedSignatory }]);
    return pdf.finish((page, of) => ({
      left: `Volt Neo · ${data.certificateNumber} · ${data.agreementNumber}`,
      right: t.page(page, of),
    }));
  }
}

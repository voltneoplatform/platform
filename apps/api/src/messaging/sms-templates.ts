import { TEXTS, type Lang } from '../documents/texts';

/**
 * DLT templates (TRAI): every SMS must match a template registered on the DLT
 * portal under Vishwakarman Investment Services Private Limited, with {#var#}
 * where the text changes. The templates are generated from the same wording
 * functions the platform sends with, so the two cannot drift apart.
 */
export const DLT_VAR = '{#var#}';
/** Most DLT portals allow up to 30 characters in each {#var#}. */
export const DLT_VAR_MAX = 30;
/** Payment links go out as short links on our own address, so the link fits in one {#var#}. */
export const PAY_LINK_BASE = 'https://api.voltcompany.in/p/';

export type DltKey =
  | 'payment_receipt'
  | 'reminder'
  | 'reminder_today'
  | 'final_notice'
  | 'immobilised'
  | 'restored'
  | 'ownership_transferred'
  | 'ticket_received'
  | 'ticket_resolved'
  | 'payment_link'
  | 'sign_in_code';

const V = DLT_VAR;

export const DLT_TEMPLATES: Record<
  DltKey,
  { name: string; when: string; render: (lang: Lang) => string }
> = {
  payment_receipt: {
    name: 'Payment receipt',
    when: 'Every payment recorded (cash, UPI or card)',
    render: (l) =>
      TEXTS[l].receiptSms({ amount: V, agreement: V, date: V, receipt: V, balance: V }),
  },
  reminder: {
    name: 'Instalment reminder',
    when: '5, 3 and 1 days before an instalment is due',
    render: (l) => TEXTS[l].reminderSms({ amount: V, agreement: V, dueDate: V, today: false }),
  },
  reminder_today: {
    name: 'Instalment due today',
    when: 'On the due date',
    render: (l) => TEXTS[l].reminderSms({ amount: V, agreement: V, dueDate: V, today: true }),
  },
  final_notice: {
    name: 'Final notice',
    when: 'Last day of grace, before the battery may be disabled',
    render: (l) => TEXTS[l].finalNoticeSms({ amount: V, agreement: V, disableFrom: V, fee: V }),
  },
  immobilised: {
    name: 'Battery disabled',
    when: 'When the battery is disabled for unpaid dues',
    render: (l) => TEXTS[l].immobilisedSms({ amount: V, agreement: V }),
  },
  restored: {
    name: 'Battery switched back on',
    when: 'When a disabled battery is switched back on',
    render: (l) => TEXTS[l].restoredSms({ agreement: V }),
  },
  ownership_transferred: {
    name: 'Ownership transferred',
    when: 'When the driver becomes the owner of the battery',
    render: (l) => TEXTS[l].transferredSms({ agreement: V, serial: V, certificate: V }),
  },
  ticket_received: {
    name: 'Service request received',
    when: 'When a battery problem is reported',
    render: (l) => TEXTS[l].ticketReceivedSms({ ticket: V, hours: V as unknown as number }),
  },
  ticket_resolved: {
    name: 'Service request closed',
    when: 'When the service request is resolved',
    render: (l) => TEXTS[l].ticketResolvedSms({ ticket: V }),
  },
  payment_link: {
    name: 'UPI payment link',
    when: 'When an agent or head office sends a UPI payment link',
    render: (l) =>
      TEXTS[l].paymentLinkSms({ amount: V, agreement: V, url: `${PAY_LINK_BASE}${V}`, until: V }),
  },
  sign_in_code: {
    name: 'Sign-in code (OTP)',
    when: 'Staff sign-in by phone (now) and Driver App sign-in (M6)',
    render: (l) => TEXTS[l].signInCodeSms({ code: V, minutes: V }),
  },
};

/** The message template names the platform stores, and the DLT template each one uses. */
const BY_MESSAGE_TEMPLATE: Record<string, DltKey> = {
  payment_receipt: 'payment_receipt',
  reminder_5: 'reminder',
  reminder_3: 'reminder',
  reminder_1: 'reminder',
  reminder_0: 'reminder_today',
  final_notice: 'final_notice',
  immobilised: 'immobilised',
  restored: 'restored',
  ownership_transferred: 'ownership_transferred',
  ticket_received: 'ticket_received',
  ticket_resolved: 'ticket_resolved',
  payment_link: 'payment_link',
  sign_in_code: 'sign_in_code',
};

export function dltKeyFor(messageTemplate: string): DltKey | null {
  return BY_MESSAGE_TEMPLATE[messageTemplate] ?? null;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Whether a message matches its DLT template, with each value 1–30 characters. */
export function matchesTemplate(body: string, key: DltKey, lang: Lang): boolean {
  const parts = DLT_TEMPLATES[key].render(lang).split(DLT_VAR).map(escapeRegExp);
  const re = new RegExp(`^${parts.join(`[\\s\\S]{1,${DLT_VAR_MAX}}`)}$`, 'u');
  return re.test(body);
}

/** GSM-7 basic set: an SMS with any other character is sent as Unicode (70 characters a part). */
const GSM7 =
  /^[@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&'()*+,\-./0-9:;<=>?¡A-ZÄÖÑÜ§¿a-zäöñüà^{}\\[~\]|€]*$/u;

export function isUnicode(text: string): boolean {
  return !GSM7.test(text);
}

/** SMS parts a message takes (what the provider charges for). */
export function smsParts(text: string): number {
  const unicode = isUnicode(text);
  const len = [...text].length;
  const single = unicode ? 70 : 160;
  const multi = unicode ? 67 : 153;
  return len <= single ? 1 : Math.ceil(len / multi);
}

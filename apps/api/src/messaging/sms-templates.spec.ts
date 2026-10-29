import { TEXTS, type Lang } from '../documents/texts';
import {
  DLT_TEMPLATES,
  PAY_LINK_BASE,
  dltKeyFor,
  isUnicode,
  matchesTemplate,
  smsParts,
  type DltKey,
} from './sms-templates';

const LANGS: Lang[] = ['EN', 'BN', 'HI'];

/** A real message for each template, built the way the platform builds it. */
function sample(key: DltKey, lang: Lang): string {
  const t = TEXTS[lang];
  switch (key) {
    case 'payment_receipt':
      return t.receiptSms({
        amount: '₹2,500',
        agreement: 'NOA-000123',
        date: '02/11/2026',
        receipt: 'VNR/2026-27/000123',
        balance: '₹1,27,500',
      });
    case 'reminder':
      return t.reminderSms({
        amount: '₹2,500',
        agreement: 'NOA-000123',
        dueDate: '02/11/2026',
        today: false,
      });
    case 'reminder_today':
      return t.reminderSms({
        amount: '₹2,500',
        agreement: 'NOA-000123',
        dueDate: '02/11/2026',
        today: true,
      });
    case 'final_notice':
      return t.finalNoticeSms({
        amount: '₹2,600',
        agreement: 'NOA-000123',
        disableFrom: '08/11/2026',
        fee: '₹100',
      });
    case 'immobilised':
      return t.immobilisedSms({ amount: '₹2,700', agreement: 'NOA-000123' });
    case 'restored':
      return t.restoredSms({ agreement: 'NOA-000123' });
    case 'ownership_transferred':
      return t.transferredSms({
        agreement: 'NOA-000123',
        serial: 'VN-48-000123',
        certificate: 'VNC/2026-27/000001',
      });
    case 'ticket_received':
      return t.ticketReceivedSms({ ticket: 'VNS-000123', hours: 48 });
    case 'ticket_resolved':
      return t.ticketResolvedSms({ ticket: 'VNS-000123' });
    case 'payment_link':
      return t.paymentLinkSms({
        amount: '₹2,500',
        agreement: 'NOA-000123',
        url: `${PAY_LINK_BASE}Ab3dE9xQ`,
        until: '06/11/2026',
      });
    case 'sign_in_code':
      return t.signInCodeSms({ code: '482913', minutes: '5' });
  }
}

describe('DLT templates', () => {
  for (const key of Object.keys(DLT_TEMPLATES) as DltKey[]) {
    for (const lang of LANGS) {
      it(`${key} (${lang}) matches what the platform sends`, () => {
        const body = sample(key, lang);
        expect(matchesTemplate(body, key, lang)).toBe(true);
        // English stays in the basic SMS alphabet (160 characters a part).
        if (lang === 'EN') expect(isUnicode(body)).toBe(false);
        expect(smsParts(body)).toBeLessThanOrEqual(lang === 'EN' ? 2 : 4);
      });
    }
  }

  it('refuses a message that strays from its template or has an over-long value', () => {
    expect(matchesTemplate('Volt Neo: hello', 'restored', 'EN')).toBe(false);
    const long = TEXTS.EN.restoredSms({ agreement: 'X'.repeat(31) });
    expect(matchesTemplate(long, 'restored', 'EN')).toBe(false);
  });

  it('maps every stored message template to a DLT template', () => {
    for (const t of [
      'payment_receipt',
      'reminder_5',
      'reminder_3',
      'reminder_1',
      'reminder_0',
      'final_notice',
      'immobilised',
      'restored',
      'ownership_transferred',
      'ticket_received',
      'ticket_resolved',
      'payment_link',
      'sign_in_code',
    ]) {
      expect(dltKeyFor(t)).not.toBeNull();
    }
    expect(dltKeyFor('something_else')).toBeNull();
  });

  it('counts SMS parts like the operators do', () => {
    expect(smsParts('a'.repeat(160))).toBe(1);
    expect(smsParts('a'.repeat(161))).toBe(2);
    expect(smsParts('অ'.repeat(70))).toBe(1);
    expect(smsParts('অ'.repeat(71))).toBe(2);
  });
});

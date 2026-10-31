import { bn } from './bn';
import { en, type MessageKey, type Messages } from './en';
import { hi } from './hi';

export const LANGS = ['BN', 'HI', 'EN'] as const;
export type Lang = (typeof LANGS)[number];

/** How each language names itself, for the picker. */
export const LANG_NAMES: Record<Lang, string> = { BN: 'বাংলা', HI: 'हिंदी', EN: 'English' };

export const MESSAGES: Record<Lang, Messages> = { EN: en, BN: bn, HI: hi };

export type Params = Record<string, string | number>;

/** Looks up a message and fills in {placeholders}. */
export function translate(lang: Lang, key: MessageKey, params: Params = {}): string {
  const text = MESSAGES[lang][key] ?? en[key];
  return text.replace(/\{(\w+)\}/g, (m, name: string) =>
    params[name] === undefined ? m : String(params[name]),
  );
}

/** Indian digit grouping (₹1,23,456.50) without relying on the phone's Intl data. */
export function rupees(paise: number): string {
  const neg = paise < 0;
  const abs = Math.abs(Math.round(paise));
  const whole = String(Math.floor(abs / 100));
  const p = abs % 100;
  const last3 = whole.slice(-3);
  const rest = whole.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  const grouped = rest ? `${rest},${last3}` : last3;
  return `${neg ? '-' : ''}₹${grouped}${p ? `.${String(p).padStart(2, '0')}` : ''}`;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** DD/MM/YYYY (and HH:MM) in India time, for a YYYY-MM-DD date or an instant. */
export function shortDate(value: string | null | undefined, withTime = false): string {
  if (!value) return '—';
  if (value.length === 10) {
    const [y, m, d] = value.split('-');
    return `${d}/${m}/${y}`;
  }
  const t = new Date(new Date(value).getTime() + 5.5 * 3_600_000);
  const date = `${pad(t.getUTCDate())}/${pad(t.getUTCMonth() + 1)}/${t.getUTCFullYear()}`;
  return withTime ? `${date} ${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}` : date;
}

export type { MessageKey };

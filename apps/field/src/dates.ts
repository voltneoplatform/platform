/**
 * Dates typed in the Field App are DD-MM-YYYY (founder, 31 Oct 2026); the API
 * takes YYYY-MM-DD.
 */

/** Keeps digits and adds the dashes as the person types: "15011990" → "15-01-1990". */
export function typeDate(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 8);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}-${d.slice(2)}`;
  return `${d.slice(0, 2)}-${d.slice(2, 4)}-${d.slice(4)}`;
}

/** "15-01-1990" → "1990-01-15"; null when the date does not exist or is incomplete. */
export function dmyToIso(value: string): string | null {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(value.trim());
  if (!m) return null;
  const [, dd, mm, yyyy] = m as unknown as [string, string, string, string];
  const t = new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd)));
  if (
    t.getUTCFullYear() !== Number(yyyy) ||
    t.getUTCMonth() !== Number(mm) - 1 ||
    t.getUTCDate() !== Number(dd) ||
    Number(yyyy) < 1900
  ) {
    return null;
  }
  return `${yyyy}-${mm}-${dd}`;
}

/** "1990-01-15" → "15-01-1990". */
export function isoToDmy(iso: string | null | undefined): string {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}-${m}-${y}`;
}

/** "1,500.50" or "1500" typed by a person → paise, or null if it is not an amount. */
export function parseRupees(text: string): number | null {
  const s = text.replace(/[,\s₹]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [r, p = ''] = s.split('.');
  const paise = Number(r) * 100 + Number(p.padEnd(2, '0'));
  return Number.isSafeInteger(paise) ? paise : null;
}

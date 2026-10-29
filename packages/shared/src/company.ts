/**
 * The company behind the Volt Neo brand (L14), from its GST registration
 * certificate (REG-06, issued 4 Sep 2026), PAN and CIN. Printed on every document
 * the platform issues. CONFIRMED by the founder on 29 Oct 2026.
 */
export const COMPANY = {
  brand: 'Volt Neo',
  legalName: 'Vishwakarman Investment Services Private Limited',
  constitution: 'Private Limited Company',
  gstin: '19AAKCV8039M1ZG',
  pan: 'AAKCV8039M',
  /** Corporate Identification Number (founder, 29 Oct 2026). */
  cin: 'U74901WB2025PTC276936' as string | null,
  /** Registered office and GST principal place of business (the same, founder 29 Oct 2026). */
  address: 'Ground Floor, 1966, Nayabad, Kolkata, West Bengal 700094',
} as const;

/** "Volt Neo is a brand of …", for document headers and footers. */
export function companyLine(): string {
  return `${COMPANY.brand} is a brand of ${COMPANY.legalName}`;
}

/** Legal name, GSTIN (and CIN once known) and address, one line each. */
export function companyIdentity(): string[] {
  const ids = [`GSTIN ${COMPANY.gstin}`, ...(COMPANY.cin ? [`CIN ${COMPANY.cin}`] : [])];
  return [COMPANY.legalName, `${ids.join(' · ')} · ${COMPANY.address}`];
}

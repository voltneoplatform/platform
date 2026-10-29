import { COMPANY, companyIdentity, companyLine } from './company';

describe('company identity', () => {
  it('matches the GST registration', () => {
    // A West Bengal GSTIN (state code 19) carries the PAN in characters 3–12.
    expect(COMPANY.gstin).toMatch(/^19[A-Z]{5}\d{4}[A-Z]\dZ[0-9A-Z]$/);
    expect(COMPANY.gstin.slice(2, 12)).toBe(COMPANY.pan);
  });

  it('names the company behind the brand', () => {
    expect(companyLine()).toBe(
      'Volt Neo is a brand of Vishwakarman Investment Services Private Limited',
    );
    expect(companyIdentity()).toEqual([
      'Vishwakarman Investment Services Private Limited',
      'GSTIN 19AAKCV8039M1ZG · Ground Floor, 1966, Nayabad, Kolkata, West Bengal 700094',
    ]);
  });
});

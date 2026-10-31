import { describe, expect, it } from 'vitest';
import {
  ageOn,
  docNumberProblem,
  maskDocNumber,
  normaliseRegistration,
  readiness,
  type ReadinessInput,
} from './drivers';
import { canMoveBattery } from './batteries';

describe('KYC document numbers', () => {
  it('accepts well-formed numbers after removing spaces and dashes', () => {
    expect(docNumberProblem('AADHAAR', '2345 6789 0123')).toBeNull();
    expect(docNumberProblem('PAN', 'abcde1234f')).toBeNull();
    expect(docNumberProblem('VOTER_ID', 'WBX1234567')).toBeNull();
    expect(docNumberProblem('DRIVING_LICENCE', 'WB-01 2019 0012345')).toBeNull();
  });

  it('rejects malformed numbers with a hint', () => {
    expect(docNumberProblem('AADHAAR', '1234 5678 9012')).toMatch(/12 digits/);
    expect(docNumberProblem('PAN', 'ABCDE12345')).toMatch(/5 letters/);
  });

  it('requires a number where the document has one, and refuses one for a photo', () => {
    expect(docNumberProblem('VOTER_ID', '')).toMatch(/required/);
    expect(docNumberProblem('DRIVER_PHOTO', null)).toBeNull();
    expect(docNumberProblem('DRIVER_PHOTO', '123')).toMatch(/does not take/);
  });

  it('masks all but the last 4 characters', () => {
    expect(maskDocNumber('AADHAAR', '0123')).toBe('XXXX XXXX 0123');
    expect(maskDocNumber('PAN', '234F')).toBe('••••234F');
    expect(maskDocNumber('DRIVER_PHOTO', null)).toBeNull();
  });
});

describe('vehicles and batteries', () => {
  it('compares registrations without spaces or dashes', () => {
    expect(normaliseRegistration('wb-02 ab 1234')).toBe('WB02AB1234');
  });

  it('allows only the manual inventory moves head office may make', () => {
    expect(canMoveBattery('IN_STOCK', 'UNDER_REPAIR')).toBe(true);
    expect(canMoveBattery('RECOVERED', 'IN_STOCK')).toBe(true);
    expect(canMoveBattery('IN_STOCK', 'INSTALLED')).toBe(false);
    expect(canMoveBattery('INSTALLED', 'IN_STOCK')).toBe(false);
    expect(canMoveBattery('RETIRED', 'IN_STOCK')).toBe(false);
  });
});

describe('driver readiness checklist', () => {
  const complete: ReadinessInput = {
    dateOfBirth: '1990-05-01',
    today: '2026-10-23',
    nomineeRecorded: true,
    documents: [
      { type: 'VOTER_ID', status: 'VERIFIED', usedForAddress: true },
      { type: 'PAN', status: 'VERIFIED', usedForAddress: false },
      { type: 'DRIVER_PHOTO', status: 'VERIFIED', usedForAddress: false },
    ],
    vehicle: { ownedByDriver: true, ownerConsentUploaded: false },
  };

  it('is ready when every item is done', () => {
    expect(readiness(complete).ready).toBe(true);
  });

  it('counts only verified documents', () => {
    const r = readiness({
      ...complete,
      documents: complete.documents.map((d) => ({ ...d, status: 'PENDING' as const })),
    });
    expect(r.ready).toBe(false);
    expect(r.items.filter((i) => !i.done).map((i) => i.item)).toEqual([
      'IDENTITY_VERIFIED',
      'PAN_VERIFIED',
      'ADDRESS_VERIFIED',
      'PHOTO_VERIFIED',
    ]);
  });

  it("needs the vehicle owner's consent only for renter-drivers (D21)", () => {
    const renter = { ...complete, vehicle: { ownedByDriver: false, ownerConsentUploaded: false } };
    expect(readiness(renter).ready).toBe(false);
    expect(
      readiness({ ...renter, vehicle: { ownedByDriver: false, ownerConsentUploaded: true } }).ready,
    ).toBe(true);
  });

  it('does not accept a PAN card as proof of address', () => {
    const r = readiness({
      ...complete,
      documents: [
        { type: 'PAN', status: 'VERIFIED', usedForAddress: true },
        { type: 'DRIVER_PHOTO', status: 'VERIFIED', usedForAddress: false },
      ],
    });
    expect(r.items.find((i) => i.item === 'ADDRESS_VERIFIED')?.done).toBe(false);
  });

  it('needs a verified PAN card (founder, 31 Oct 2026)', () => {
    const noPan = complete.documents.filter((d) => d.type !== 'PAN');
    expect(readiness({ ...complete, documents: noPan }).ready).toBe(false);
    const pending = [
      ...noPan,
      { type: 'PAN' as const, status: 'PENDING' as const, usedForAddress: false },
    ];
    expect(readiness({ ...complete, documents: pending }).ready).toBe(false);
  });

  it('needs the driver to be 18 on the day', () => {
    expect(ageOn('2008-10-24', '2026-10-23')).toBe(17);
    expect(ageOn('2008-10-23', '2026-10-23')).toBe(18);
    expect(readiness({ ...complete, dateOfBirth: '2008-10-24' }).ready).toBe(false);
  });
});

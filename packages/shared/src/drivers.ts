/**
 * Drivers, vehicles and KYC (Platform MVP Spec V1, module 5; Foundation V2.1
 * sections 4 and 7; legal items L6 and L7 are still open).
 */
import { normaliseSerial } from './batteries';

export const DRIVER_LANGUAGES = ['BN', 'HI', 'EN'] as const;
export type DriverLanguage = (typeof DRIVER_LANGUAGES)[number];
export const DRIVER_LANGUAGE_LABELS: Record<DriverLanguage, string> = {
  BN: 'Bengali',
  HI: 'Hindi',
  EN: 'English',
};

/**
 * How the driver is described in the agreement: son of, daughter of or wife of
 * a named relative, as is usual in Indian agreements (founder, 31 Oct 2026).
 */
export const RELATIVE_RELATIONS = ['SON_OF', 'DAUGHTER_OF', 'WIFE_OF'] as const;
export type RelativeRelation = (typeof RELATIVE_RELATIONS)[number];
export const RELATIVE_RELATION_LABELS: Record<RelativeRelation, string> = {
  SON_OF: 'son of',
  DAUGHTER_OF: 'daughter of',
  WIFE_OF: 'wife of',
};

export const KYC_DOC_TYPES = [
  'AADHAAR',
  'VOTER_ID',
  'DRIVING_LICENCE',
  'PAN',
  'PASSPORT',
  'RATION_CARD',
  'OTHER_ID',
  'DRIVER_PHOTO',
] as const;
export type KycDocType = (typeof KYC_DOC_TYPES)[number];

export interface KycDocTypeInfo {
  label: string;
  /** Whether the document carries a number we record. */
  hasNumber: boolean;
  /** Whether it can prove identity on the readiness checklist. */
  identity: boolean;
  /** Whether it can serve as proof of address. */
  canProveAddress: boolean;
  /** Loose format check after normalising; null means any 4-30 letters/digits. */
  pattern: RegExp | null;
  formatHint?: string;
  /**
   * Store only the last 4 digits and a keyed fingerprint for duplicate checks,
   * never the full number. Used for Aadhaar until legal item L7 is answered.
   */
  storeLast4Only: boolean;
}

export const KYC_DOC_INFO: Record<KycDocType, KycDocTypeInfo> = {
  AADHAAR: {
    label: 'Aadhaar',
    hasNumber: true,
    identity: true,
    canProveAddress: true,
    pattern: /^[2-9]\d{11}$/,
    formatHint: '12 digits',
    storeLast4Only: true,
  },
  VOTER_ID: {
    label: 'Voter ID (EPIC)',
    hasNumber: true,
    identity: true,
    canProveAddress: true,
    pattern: /^[A-Z]{3}\d{7}$/,
    formatHint: '3 letters and 7 digits',
    storeLast4Only: false,
  },
  DRIVING_LICENCE: {
    label: 'Driving licence',
    hasNumber: true,
    identity: true,
    canProveAddress: true,
    pattern: /^[A-Z]{2}[0-9A-Z]{6,18}$/,
    formatHint: 'starts with the 2-letter state code',
    storeLast4Only: false,
  },
  PAN: {
    label: 'PAN card',
    hasNumber: true,
    identity: true,
    canProveAddress: false,
    pattern: /^[A-Z]{5}\d{4}[A-Z]$/,
    formatHint: '5 letters, 4 digits, 1 letter',
    storeLast4Only: false,
  },
  PASSPORT: {
    label: 'Passport',
    hasNumber: true,
    identity: true,
    canProveAddress: true,
    pattern: /^[A-Z]\d{7}$/,
    formatHint: '1 letter and 7 digits',
    storeLast4Only: false,
  },
  RATION_CARD: {
    label: 'Ration card',
    hasNumber: true,
    identity: false,
    canProveAddress: true,
    pattern: null,
    storeLast4Only: false,
  },
  OTHER_ID: {
    label: 'Other document',
    hasNumber: true,
    identity: false,
    canProveAddress: true,
    pattern: null,
    storeLast4Only: false,
  },
  DRIVER_PHOTO: {
    label: 'Driver photo',
    hasNumber: false,
    identity: false,
    canProveAddress: false,
    pattern: null,
    storeLast4Only: false,
  },
};

export function normaliseDocNumber(raw: string): string {
  return raw.replace(/[\s\-/.]/g, '').toUpperCase();
}

/** Returns an error message, or null if the number is acceptable for the type. */
export function docNumberProblem(type: KycDocType, raw: string | null | undefined): string | null {
  const info = KYC_DOC_INFO[type];
  if (!info.hasNumber) return raw ? `${info.label} does not take a number` : null;
  const n = normaliseDocNumber(raw ?? '');
  if (!n) return `${info.label} number is required`;
  const pattern = info.pattern ?? /^[0-9A-Z]{4,30}$/;
  if (!pattern.test(n)) {
    return `${info.label} number looks wrong${info.formatHint ? ` (expected ${info.formatHint})` : ''}`;
  }
  return null;
}

/** Shows only the last 4 characters, e.g. "XXXX XXXX 1234" or "••••1234". */
export function maskDocNumber(type: KycDocType, last4: string | null): string | null {
  if (!last4) return null;
  return type === 'AADHAAR' ? `XXXX XXXX ${last4}` : `••••${last4}`;
}

/** Vehicle registration numbers are compared without spaces or dashes, in capitals. */
export function normaliseRegistration(raw: string): string {
  return normaliseSerial(raw).replace(/[-/.]/g, '');
}

export const MIN_DRIVER_AGE = 18;

/** Age in whole years on a given date (dates as YYYY-MM-DD). */
export function ageOn(dateOfBirth: string, on: string): number {
  const [by, bm, bd] = dateOfBirth.split('-').map(Number) as [number, number, number];
  const [oy, om, od] = on.split('-').map(Number) as [number, number, number];
  let age = oy - by;
  if (om < bm || (om === bm && od < bd)) age -= 1;
  return age;
}

// ---------------------------------------------------------------------------
// Readiness: what must be in place before an agreement can be signed (M2).
// PROPOSED checklist based on Foundation section 7, step 3, and D21, D52.
// ---------------------------------------------------------------------------

export interface ReadinessInput {
  /** The driver gave the OTP sent to the current mobile number. */
  phoneVerified: boolean;
  planChosen: boolean;
  dateOfBirth: string | null;
  today: string;
  nomineeRecorded: boolean;
  documents: {
    type: KycDocType;
    status: 'PENDING' | 'VERIFIED' | 'REJECTED';
    usedForAddress: boolean;
  }[];
  vehicle: { ownedByDriver: boolean; ownerConsentUploaded: boolean } | null;
}

export const READINESS_ITEMS = [
  'PHONE_VERIFIED',
  'PLAN_CHOSEN',
  'ADULT',
  'IDENTITY_VERIFIED',
  'PAN_VERIFIED',
  'ADDRESS_VERIFIED',
  'PHOTO_VERIFIED',
  'VEHICLE_RECORDED',
  'OWNER_CONSENT',
  'NOMINEE_RECORDED',
] as const;
export type ReadinessItem = (typeof READINESS_ITEMS)[number];

export const READINESS_LABELS: Record<ReadinessItem, string> = {
  PHONE_VERIFIED: 'Mobile number confirmed by OTP',
  PLAN_CHOSEN: 'Plan chosen',
  ADULT: `Driver is ${MIN_DRIVER_AGE} or older`,
  IDENTITY_VERIFIED: 'Identity document verified',
  PAN_VERIFIED: 'PAN card verified',
  ADDRESS_VERIFIED: 'Proof of address verified',
  PHOTO_VERIFIED: 'Driver photo verified',
  VEHICLE_RECORDED: 'Vehicle recorded',
  OWNER_CONSENT: "Vehicle owner's consent uploaded (renter-drivers)",
  NOMINEE_RECORDED: 'Nominee recorded',
};

export interface Readiness {
  ready: boolean;
  items: { item: ReadinessItem; done: boolean; applies: boolean }[];
}

export function readiness(input: ReadinessInput): Readiness {
  const verified = input.documents.filter((d) => d.status === 'VERIFIED');
  const renter = input.vehicle ? !input.vehicle.ownedByDriver : false;
  const items: Readiness['items'] = [
    // Founder, 1 Nov 2026: the driver gives an OTP at registration, and a plan is chosen.
    { item: 'PHONE_VERIFIED', applies: true, done: input.phoneVerified },
    { item: 'PLAN_CHOSEN', applies: true, done: input.planChosen },
    {
      item: 'ADULT',
      applies: true,
      done: !!input.dateOfBirth && ageOn(input.dateOfBirth, input.today) >= MIN_DRIVER_AGE,
    },
    {
      item: 'IDENTITY_VERIFIED',
      applies: true,
      done: verified.some((d) => KYC_DOC_INFO[d.type].identity),
    },
    // The agreement prints the driver's PAN (founder, 31 Oct 2026).
    { item: 'PAN_VERIFIED', applies: true, done: verified.some((d) => d.type === 'PAN') },
    {
      item: 'ADDRESS_VERIFIED',
      applies: true,
      done: verified.some((d) => d.usedForAddress && KYC_DOC_INFO[d.type].canProveAddress),
    },
    {
      item: 'PHOTO_VERIFIED',
      applies: true,
      done: verified.some((d) => d.type === 'DRIVER_PHOTO'),
    },
    { item: 'VEHICLE_RECORDED', applies: true, done: !!input.vehicle },
    {
      item: 'OWNER_CONSENT',
      applies: renter,
      done: !renter || !!input.vehicle?.ownerConsentUploaded,
    },
    { item: 'NOMINEE_RECORDED', applies: true, done: input.nomineeRecorded },
  ];
  return { ready: items.every((i) => i.done), items };
}

// ---------------------------------------------------------------------------
// Onboarding (founder, 1 Nov 2026): OTP and location at registration, a plan,
// then final approval by a super admin, operations manager or plan manager.
// ---------------------------------------------------------------------------

export const DRIVER_APPROVALS = ['AWAITING', 'APPROVED', 'REJECTED'] as const;
export type DriverApproval = (typeof DRIVER_APPROVALS)[number];

/** Where a driver stands before and after an agreement, for lists and badges. */
export type OnboardingStage =
  'PAPERWORK' | 'AWAITING_APPROVAL' | 'REJECTED' | 'APPROVED' | 'AGREEMENT';

export function onboardingStage(input: {
  ready: boolean;
  approval: DriverApproval;
  hasOpenAgreement: boolean;
}): OnboardingStage {
  if (input.hasOpenAgreement) return 'AGREEMENT';
  if (input.approval === 'APPROVED') return 'APPROVED';
  if (input.approval === 'REJECTED') return 'REJECTED';
  return input.ready ? 'AWAITING_APPROVAL' : 'PAPERWORK';
}

export const ONBOARDING_STAGE_LABELS: Record<Exclude<OnboardingStage, 'AGREEMENT'>, string> = {
  PAPERWORK: 'Paperwork in progress',
  AWAITING_APPROVAL: 'Awaiting approval',
  REJECTED: 'Not approved',
  APPROVED: 'Approved: assign a battery',
};

/**
 * Read to the driver before they give the registration code. Version is stored
 * with the driver. REQUIRES VALIDATION (lawyer, DPDP Act consent wording).
 */
export const REGISTRATION_CONSENT_VERSION = 'reg-consent-v1';
export const REGISTRATION_CONSENT: Record<DriverLanguage, string> = {
  EN: 'I agree that Volt Neo may collect and verify my documents and details for a battery agreement. I am giving this code to the Volt Neo agent to confirm my mobile number.',
  BN: 'আমি সম্মতি দিচ্ছি যে Volt Neo ব্যাটারি চুক্তির জন্য আমার নথি ও তথ্য সংগ্রহ ও যাচাই করতে পারে। আমার মোবাইল নম্বর নিশ্চিত করতে আমি এই কোড Volt Neo-র এজেন্টকে দিচ্ছি।',
  HI: 'मैं सहमति देता/देती हूँ कि Volt Neo बैटरी अनुबंध के लिए मेरे दस्तावेज़ और जानकारी ले और जाँच सके। अपना मोबाइल नंबर पक्का करने के लिए मैं यह कोड Volt Neo एजेंट को दे रहा/रही हूँ।',
};

/**
 * Geotags from the Field App (founder, 1 Nov 2026): registration and
 * installation are saved only with the phone's location. ASSUMED: a fix
 * rougher than 200 m is refused (move into the open and try again).
 */
export const MAX_GEOTAG_ACCURACY_M = 200;

export interface Geotag {
  lat: number;
  lng: number;
  accuracyM: number;
}

/** Returns an error message, or null if the geotag is usable. */
export function geotagProblem(g: Partial<Geotag> | null | undefined): string | null {
  if (!g || typeof g.lat !== 'number' || typeof g.lng !== 'number') {
    return 'The location is missing. Turn on location and try again.';
  }
  if (!Number.isFinite(g.lat) || g.lat < -90 || g.lat > 90) return 'The location is not valid.';
  if (!Number.isFinite(g.lng) || g.lng < -180 || g.lng > 180) return 'The location is not valid.';
  if (typeof g.accuracyM !== 'number' || !Number.isFinite(g.accuracyM) || g.accuracyM < 0) {
    return 'The location is not valid.';
  }
  if (g.accuracyM > MAX_GEOTAG_ACCURACY_M) {
    return `The location is too rough (about ${Math.round(g.accuracyM)} m). Move into the open and try again.`;
  }
  return null;
}

export function mapLink(g: { lat: number; lng: number }): string {
  return `https://www.google.com/maps?q=${g.lat.toFixed(6)},${g.lng.toFixed(6)}`;
}

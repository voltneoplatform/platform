/**
 * Installation photos (founder, 10 Nov 2026). Each installation is recorded with
 * a photo of each item below; head office checks the photos one by one, like KYC
 * documents, and then gives the final approval that starts the agreement.
 */
export const INSTALLATION_ITEMS = [
  'BATTERY',
  'GPS',
  'VEHICLE',
  'VOLTAGE',
  'HANDOVER',
  'OTHER',
] as const;
export type InstallationItem = (typeof INSTALLATION_ITEMS)[number];

/** Every installation needs at least one checked photo of each of these. */
export const REQUIRED_INSTALLATION_ITEMS: readonly InstallationItem[] = [
  'BATTERY',
  'GPS',
  'VEHICLE',
  'VOLTAGE',
  'HANDOVER',
];

/** Most photos of one item in one upload. */
export function maxInstallationPhotos(item: InstallationItem): number {
  return item === 'OTHER' ? 4 : 3;
}

export const INSTALLATION_ITEM_LABELS: Record<InstallationItem, string> = {
  BATTERY: 'Battery fitted',
  GPS: 'GPS device',
  VEHICLE: 'Vehicle with number plate',
  VOLTAGE: 'Voltage meter reading',
  HANDOVER: 'Driver handover',
  OTHER: 'Other',
};

/** What the photo must show, for the installer and the person checking it. */
export const INSTALLATION_ITEM_HINTS: Record<InstallationItem, string> = {
  BATTERY: 'The battery in the vehicle, with its serial number readable',
  GPS: 'The fitted GPS device, with its IMEI readable',
  VEHICLE: 'The e-rickshaw, with its registration number readable',
  VOLTAGE: "The meter showing the battery's voltage",
  HANDOVER: 'The driver with the vehicle at handover',
  OTHER: 'Anything else worth keeping (optional)',
};

export type InstallationPhotoStatus = 'PENDING' | 'VERIFIED' | 'REJECTED';
export type InstallationItemStatus = 'MISSING' | InstallationPhotoStatus;

/**
 * Where one item stands: VERIFIED once any photo of it is verified, PENDING
 * while a photo waits to be checked, REJECTED when every photo was rejected
 * (a new photo is needed), MISSING when there is none.
 */
export function installationItemStatus(
  statuses: readonly InstallationPhotoStatus[],
): InstallationItemStatus {
  if (statuses.includes('VERIFIED')) return 'VERIFIED';
  if (statuses.includes('PENDING')) return 'PENDING';
  return statuses.length ? 'REJECTED' : 'MISSING';
}

/**
 * Whether the final approval can be given: every required item has a verified
 * photo and no photo is still waiting to be checked.
 */
export function installationReadyForApproval(
  photos: readonly { item: InstallationItem; status: InstallationPhotoStatus }[],
): boolean {
  if (photos.some((p) => p.status === 'PENDING')) return false;
  return REQUIRED_INSTALLATION_ITEMS.every((item) =>
    photos.some((p) => p.item === item && p.status === 'VERIFIED'),
  );
}

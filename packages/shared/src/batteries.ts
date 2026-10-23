/**
 * Battery types and inventory (Platform MVP Spec V1, modules 2 and 3).
 */

export const VEHICLE_TYPES = ['TOTO', 'E_RICKSHAW', 'E_THREE_WHEELER'] as const;
export type VehicleType = (typeof VEHICLE_TYPES)[number];

export const VEHICLE_TYPE_LABELS: Record<VehicleType, string> = {
  TOTO: 'Toto',
  E_RICKSHAW: 'E-rickshaw',
  E_THREE_WHEELER: 'E-three-wheeler',
};

/** Suggestions only: head office can type any chemistry the supplier states. */
export const CHEMISTRY_SUGGESTIONS = ['LFP (lithium iron phosphate)', 'NMC', 'Lead-acid'] as const;

export const BATTERY_STATUSES = [
  'IN_STOCK',
  'INSTALLED',
  'UNDER_REPAIR',
  'RECOVERED',
  'TRANSFERRED',
  'RETIRED',
] as const;
export type BatteryStatus = (typeof BATTERY_STATUSES)[number];

export const BATTERY_STATUS_LABELS: Record<BatteryStatus, string> = {
  IN_STOCK: 'In stock',
  INSTALLED: 'Installed',
  UNDER_REPAIR: 'Under repair',
  RECOVERED: 'Recovered',
  TRANSFERRED: 'Transferred to driver',
  RETIRED: 'Retired',
};

/**
 * Status changes head office can make by hand in the inventory screen.
 * Installed, recovered and transferred are set only by their own workflows
 * (installation in M2, recovery in M3, ownership transfer in M4).
 * Retirement always needs a second person's approval (maker-checker).
 */
export const MANUAL_BATTERY_MOVES: Record<BatteryStatus, readonly BatteryStatus[]> = {
  IN_STOCK: ['UNDER_REPAIR'],
  UNDER_REPAIR: ['IN_STOCK'],
  RECOVERED: ['IN_STOCK', 'UNDER_REPAIR'],
  INSTALLED: [],
  TRANSFERRED: [],
  RETIRED: [],
};

/** Statuses from which a battery may be put forward for retirement. */
export const RETIRABLE_STATUSES: readonly BatteryStatus[] = [
  'IN_STOCK',
  'UNDER_REPAIR',
  'RECOVERED',
];

export function canMoveBattery(from: BatteryStatus, to: BatteryStatus): boolean {
  return MANUAL_BATTERY_MOVES[from].includes(to);
}

/** Serial numbers and GPS IDs are compared without spaces and in capitals. */
export function normaliseSerial(raw: string): string {
  return raw.replace(/\s+/g, '').toUpperCase();
}

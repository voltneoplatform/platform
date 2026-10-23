/** Shapes returned by the API, as the admin panel uses them. */

export interface CostRow {
  id: string;
  purchaseCost: number;
  gpsCost: number;
  serviceCost: number;
  financingCost: number;
  collectionCost: number;
  expectedLossCost: number;
  costFloor: number;
  note: string | null;
  createdAt: string;
  enteredByName?: string | null;
}

export interface BatteryTypeRow {
  id: string;
  name: string;
  voltage: number;
  capacityAh: number;
  chemistry: string;
  supplier: string;
  warrantyMonths: number;
  warrantyNotes: string | null;
  compatibleVehicles: string[];
  notes: string | null;
  status: 'ACTIVE' | 'ARCHIVED';
  batteryCounts?: Record<string, number>;
  currentCost?: CostRow;
  costHistory?: CostRow[];
}

export interface CustodyRow {
  id: string;
  event: string;
  fromStatus: string | null;
  toStatus: string;
  toHolder: string;
  toLocation: string | null;
  toStaffName: string | null;
  note: string | null;
  byName: string | null;
  at: string;
}

export interface BatteryRow {
  id: string;
  serial: string;
  gpsDeviceId: string | null;
  batteryType: { id: string; name: string };
  status: string;
  holder: string;
  location: string | null;
  purchaseDate: string;
  purchaseCost?: number;
  supplierRef: string | null;
  notes: string | null;
  retiredAt: string | null;
  createdAt: string;
  custody?: CustodyRow[];
  pendingRetirement?: { id: string; reason: string; requestedAt: string } | null;
}

export interface Paged<T> {
  total: number;
  page: number;
  limit: number;
  items: T[];
}

export interface PriceRow {
  batteryTypeId: string;
  batteryTypeName: string;
  batteryTypeStatus: string;
  downPayment: number;
  instalment: number;
  totalPayable: number;
  costFloor?: number | null;
}

export interface FloorRow {
  batteryTypeId: string;
  batteryTypeName: string;
  totalPayable: number;
  costFloor: number;
  margin: number;
  passes: boolean;
}

export interface FloorCheck {
  passes: boolean;
  checkedAt: string;
  rows: FloorRow[];
}

export interface PlanVersionRow {
  id: string;
  version: number;
  status: 'DRAFT' | 'PENDING_APPROVAL' | 'PUBLISHED' | 'SUPERSEDED';
  termMonths: number | null;
  graceDays: number;
  lateFeePerDayPaise: number;
  lateFeeCapDays: number;
  names: { bn: string; hi: string; en: string } | null;
  notes: string | null;
  prices: PriceRow[];
  costFloorPassed?: boolean | null;
  costFloorCheck?: FloorCheck | null;
  costFloorException: boolean;
  approvalRequestId: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PlanDetail {
  id: string;
  code: string;
  names: { bn: string; hi: string; en: string };
  status: 'DRAFT' | 'ACTIVE' | 'RETIRED';
  versions: PlanVersionRow[];
}

export interface PlanListRow {
  id: string;
  code: string;
  names: { bn: string; hi: string; en: string };
  status: 'DRAFT' | 'ACTIVE' | 'RETIRED';
  published: PlanVersionRow | null;
  openVersion: { id: string; version: number; status: string } | null;
  belowFloorNow?: boolean;
}

export interface ApprovalRow {
  id: string;
  type: string;
  targetTable: string;
  targetId: string;
  summary: string;
  reason: string;
  payload: unknown;
  status: string;
  requestedByName: string | null;
  requestedAt: string;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  approverRoles: string[];
  canDecide: boolean;
  isMine: boolean;
}

export interface KycDoc {
  id: string;
  type: string;
  label: string;
  maskedNumber: string | null;
  fullNumberStored: boolean;
  usedForAddress: boolean;
  fileName: string;
  fileType: string;
  fileSize: number;
  status: 'PENDING' | 'VERIFIED' | 'REJECTED';
  verifiedByName: string | null;
  verifiedAt: string | null;
  rejectionReason: string | null;
  uploadedByName: string | null;
  createdAt: string;
}

export interface VehicleView {
  id: string;
  registration: string | null;
  chassisNumber: string | null;
  type: string;
  makeModel: string | null;
  ownedByDriver: boolean;
  ownerName: string | null;
  ownerPhone: string | null;
  ownerConsent: { fileName: string; fileType: string; uploadedAt: string } | null;
  createdAt: string;
}

export interface DriverDetail {
  id: string;
  name: string;
  phone: string;
  altPhone: string | null;
  language: 'BN' | 'HI' | 'EN';
  dateOfBirth: string | null;
  addressLine: string;
  area: string | null;
  district: string;
  state: string;
  pinCode: string;
  status: 'ACTIVE' | 'INACTIVE';
  nominee: { name: string | null; relation: string | null; phone: string | null };
  notes: string | null;
  createdAt: string;
  vehicle: VehicleView | null;
  previousVehicles: VehicleView[];
  documents: KycDoc[];
  readiness: { ready: boolean; items: { item: string; done: boolean; applies: boolean }[] };
  duplicates: { kind: string; driverId: string; driverName: string; detail: string }[];
}

export interface DriverListRow {
  id: string;
  name: string;
  phone: string;
  language: string;
  district: string;
  status: string;
  vehicle: { registration: string | null; type: string; ownedByDriver: boolean } | null;
  ready: boolean;
  itemsDone: number;
  itemsTotal: number;
  pendingDocuments: number;
  createdAt: string;
}

import type { CollectionStage, Role } from '@voltneo/shared';

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

// ---------------------------------------------------------------------------
// M2: agreements and payments
// ---------------------------------------------------------------------------

export type Lang = 'BN' | 'HI' | 'EN';

export interface StaffDirectoryRow {
  id: string;
  name: string;
  role: Role;
}

export interface AgreementOption {
  planVersionId: string;
  planId: string;
  planCode: string;
  version: number;
  names: Record<Lang, string>;
  termMonths: number;
  graceDays: number;
  lateFeePerDayPaise: number;
  lateFeeCapDays: number;
  prices: {
    batteryTypeId: string;
    batteryTypeName: string;
    compatibleVehicles: string[];
    downPayment: number;
    instalment: number;
    totalPayable: number;
  }[];
}

export interface AgreementListRow {
  id: string;
  number: string;
  state: string;
  driver: { id: string; name: string; phone: string };
  plan: string;
  planName: string;
  batteryType: string;
  batterySerial: string | null;
  totalPayable: number;
  paid: number;
  outstanding: number;
  dueDay: number;
  firstDueDate: string;
  createdAt: string;
}

export interface ScheduleRow {
  id: string | null;
  sequence: number;
  dueDate: string | null;
  amount: number;
  amountPaid: number;
  status: 'UNPAID' | 'PART_PAID' | 'PAID';
  paidAt: string | null;
}

export interface AgreementDetail {
  id: string;
  number: string;
  state: string;
  driver: { id: string; name: string; phone: string; language: Lang };
  vehicle: {
    id: string;
    registration: string | null;
    chassisNumber: string | null;
    type: string;
    ownedByDriver: boolean;
    isCurrent: boolean;
  };
  plan: {
    id: string;
    code: string;
    planVersionId: string;
    version: number;
    versionStatus: string;
    names: Record<Lang, string>;
  };
  batteryType: { id: string; name: string; voltage: string; capacityAh: string };
  battery: { id: string; serial: string; gpsDeviceId: string | null } | null;
  terms: {
    downPayment: number;
    instalment: number;
    termMonths: number;
    totalPayable: number;
    dueDay: number;
    firstDueDate: string;
    lastDueDate: string;
    graceDays: number;
    lateFeePerDayPaise: number;
    lateFeeCapDays: number;
  };
  language: Lang;
  documentVersion: string;
  scheduleRevision: number;
  signed: {
    signedAt: string;
    method: string;
    fileName: string;
    explainedInLanguage: Lang;
    explainedByName: string | null;
    recordedByName: string | null;
  } | null;
  activatedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  notes: string | null;
  createdAt: string;
  createdByName: string | null;
  money: {
    paid: number;
    outstanding: number;
    lateFeesDue: number;
    nextDue: { sequence: number; dueDate: string | null; amountLeft: number } | null;
    instalmentsPaid: number;
  };
  schedule: ScheduleRow[];
  lateFees: { id: string; date: string; amount: number; amountPaid: number }[];
  events: {
    id: string;
    event: string;
    fromState: string | null;
    toState: string;
    reason: string | null;
    actorType: string;
    actorName: string | null;
    at: string;
  }[];
  installation: {
    id: string;
    installedAt: string;
    location: string;
    voltageReading: string;
    readingsNote: string | null;
    conditionNote: string;
    driverConfirmed: boolean;
    technicianName: string | null;
    recordedByName: string | null;
    photos: { id: string; fileName: string }[];
  } | null;
  readiness: DriverDetail['readiness'] | null;
  pendingVariation: { id: string; summary: string; requestedById: string } | null;
  allowed: {
    edit: boolean;
    sign: boolean;
    cancel: boolean;
    reschedule: boolean;
    install: boolean;
    pay: boolean;
  };
}

export interface PaymentRow {
  id: string;
  receiptNumber: string;
  agreement: { id: string; number: string; state: string };
  driver: { id: string; name: string; phone: string };
  amount: number;
  excess: number;
  balanceAfter: number;
  method: 'UPI' | 'CARD' | 'CASH';
  source: 'MANUAL' | 'GATEWAY';
  provider: string | null;
  providerRef: string | null;
  reference: string | null;
  collectedById: string | null;
  collectedByName: string | null;
  recordedByName: string | null;
  note: string | null;
  receivedAt: string;
  createdAt: string;
  allocations: {
    kind: 'LATE_FEE' | 'DOWN_PAYMENT' | 'INSTALMENT' | 'EXCESS';
    amount: number;
    sequence: number | null;
    dueDate: string | null;
    lateFeeDate: string | null;
  }[];
  messages: {
    id: string;
    channel: string;
    status: string;
    error: string | null;
    sentAt: string | null;
  }[];
  repeated?: boolean;
}

export interface CashHolding {
  agentId: string;
  agentName: string;
  role: string;
  collected: number;
  paidIn: number;
  held: number;
  awaitingCheck: number;
}

export interface CashDepositRow {
  id: string;
  agentId: string;
  agentName: string | null;
  amount: number;
  bankReference: string;
  depositedAt: string;
  status: 'PENDING' | 'RECONCILED';
  recordedById: string;
  recordedByName: string | null;
  reconciledByName: string | null;
  reconciledAt: string | null;
  note: string | null;
  createdAt: string;
}

export interface LedgerBalances {
  accounts: { account: string; debit: number; credit: number; net: number }[];
  totals: { debit: number; credit: number };
  balanced: boolean;
}

// ---------------------------------------------------------------------------
// M3: collections
// ---------------------------------------------------------------------------

export type CollectionStageName = CollectionStage;

export interface QueueRow {
  agreementId: string;
  number: string;
  state: string;
  stage: CollectionStageName;
  driver: { id: string; name: string; phone: string; area: string | null; district: string };
  vehicle: string | null;
  battery: { serial: string; gpsDeviceId: string | null } | null;
  spellStartedOn: string | null;
  daysOverdue: number;
  overdueAmount: number;
  lateFeesDue: number;
  toClear: number;
  immobilisedAt: string | null;
  recoveryDueOn: string | null;
  restoreDueSince: string | null;
}

export interface CollectionsQueue {
  today: string;
  counts: Partial<Record<CollectionStageName, number>>;
  items: QueueRow[];
  lastRuns: {
    job: string;
    date: string;
    status: string;
    summary: Record<string, unknown> | null;
    finishedAt: string | null;
  }[];
}

export interface AgreementCollections {
  today: string;
  stage: CollectionStageName | null;
  spellStartedOn: string | null;
  daysOverdue: number;
  overdueAmount: number;
  lateFeesDue: number;
  toClear: number;
  lateFeeFrom: string | null;
  lateFeeDaysInSpell: number;
  lateFeeCapDays: number;
  immobilisedAt: string | null;
  recoveryDueOn: string | null;
  restoreDueSince: string | null;
  immobilisationRequest: {
    id: string;
    status: string;
    requestedByName: string | null;
    requestedAt: string;
  } | null;
  recoveryRequest: {
    id: string;
    status: string;
    requestedByName: string | null;
    requestedAt: string;
  } | null;
  allowed: {
    requestImmobilisation: boolean;
    recordDisable: boolean;
    recordRestore: boolean;
    requestRecovery: boolean;
    recordRecovery: boolean;
  };
  log: {
    id: string;
    action: 'DISABLE' | 'RESTORE';
    performedAt: string;
    performedByName: string | null;
    recordedByName: string | null;
    portalReference: string;
    vehicleStationaryConfirmed: boolean;
    note: string | null;
  }[];
  recovery: {
    id: string;
    recoveredAt: string;
    recoveredByName: string | null;
    location: string;
    conditionNote: string;
    writtenOffAmount: number;
    writtenOffLateFees: number;
    photos: { id: string; fileName: string }[];
  } | null;
  notices: { kind: string; refDate: string; createdAt: string }[];
}

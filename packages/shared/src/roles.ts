/**
 * Staff roles and what each may do (Platform MVP Spec V1, section 2).
 *
 * Roles are defined in code for the MVP. The permission map is the single
 * source of truth: the API enforces it, and the admin panel and Field App use
 * it only to hide screens a user cannot use.
 */

export const ROLES = [
  'SUPER_ADMIN',
  'PLAN_MANAGER',
  'OPERATIONS_MANAGER',
  'FINANCE',
  'SUPPORT',
  'FIELD_AGENT',
  'TECHNICIAN',
  'RECOVERY',
] as const;

export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  SUPER_ADMIN: 'Super admin',
  PLAN_MANAGER: 'Plan manager (head office)',
  OPERATIONS_MANAGER: 'Operations manager',
  FINANCE: 'Finance',
  SUPPORT: 'Support desk',
  FIELD_AGENT: 'Field agent',
  TECHNICIAN: 'Technician',
  RECOVERY: 'Recovery staff',
};

/** Roles that work in the head-office admin panel. The rest use the Field App. */
export const HEAD_OFFICE_ROLES: readonly Role[] = [
  'SUPER_ADMIN',
  'PLAN_MANAGER',
  'OPERATIONS_MANAGER',
  'FINANCE',
  'SUPPORT',
];

export const FIELD_ROLES: readonly Role[] = ['FIELD_AGENT', 'TECHNICIAN', 'RECOVERY'];

export const PERMISSIONS = [
  // Access
  'admin_panel.access',
  'field_app.access',
  // Module 1: staff and roles
  'staff.read',
  'staff.manage',
  'settings.manage',
  // Modules 2-4: battery types, inventory, plans
  'battery_types.read',
  'battery_types.manage',
  'batteries.read',
  'batteries.manage',
  'plans.read',
  'plans.manage',
  // Module 5: drivers and KYC
  'drivers.read',
  'drivers.manage',
  'kyc.view_full',
  // Modules 6-7: agreements and installation
  'agreements.read',
  'agreements.manage',
  'installations.record',
  // Module 8: payments
  'payments.read',
  'payments.record',
  'payments.collect_cash',
  'cash_deposits.reconcile',
  // Module 9: collections
  'collections.read',
  'collections.assign',
  'recovery.record',
  // Maker-checker
  'approvals.request',
  'approvals.decide',
  // Module 10: service
  'tickets.read',
  'tickets.manage',
  'messages.send',
  // Modules 11-12: dashboard and audit
  'reports.read',
  'audit.read',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const HEAD_OFFICE_READ: Permission[] = [
  'admin_panel.access',
  'battery_types.read',
  'batteries.read',
  'plans.read',
  'drivers.read',
  'agreements.read',
  'payments.read',
  'collections.read',
  'tickets.read',
  'reports.read',
];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  // All settings and staff management. The "cannot approve own request" rule is
  // enforced separately for every role, including this one.
  SUPER_ADMIN: [...PERMISSIONS].filter((p) => p !== 'field_app.access'),

  PLAN_MANAGER: [
    ...HEAD_OFFICE_READ,
    'battery_types.manage',
    'batteries.manage',
    'plans.manage',
    'drivers.manage',
    'agreements.manage',
    'installations.record',
    'approvals.request',
    'approvals.decide',
  ],

  // Cannot edit payments (spec section 2).
  OPERATIONS_MANAGER: [
    ...HEAD_OFFICE_READ,
    'staff.read',
    'collections.assign',
    'drivers.manage',
    'agreements.manage',
    'installations.record',
    'recovery.record',
    'tickets.manage',
    'messages.send',
    'approvals.request',
    'approvals.decide',
  ],

  // Cannot change plans (spec section 2).
  FINANCE: [
    ...HEAD_OFFICE_READ,
    'payments.record',
    'payments.collect_cash',
    'cash_deposits.reconcile',
    'approvals.request',
    'approvals.decide',
  ],

  // Cannot see full ID numbers or approve anything (spec section 2).
  SUPPORT: [
    'admin_panel.access',
    'drivers.read',
    'agreements.read',
    'payments.read',
    'tickets.read',
    'tickets.manage',
    'messages.send',
  ],

  // Cannot change any plan term (D26).
  FIELD_AGENT: [
    'field_app.access',
    'plans.read',
    'drivers.read',
    'drivers.manage',
    'agreements.read',
    'payments.collect_cash',
  ],

  // Cannot collect payments (spec section 2).
  TECHNICIAN: [
    'field_app.access',
    'batteries.read',
    'agreements.read',
    'installations.record',
    'tickets.read',
  ],

  RECOVERY: ['field_app.access', 'agreements.read', 'recovery.record'],
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

/**
 * Maker-checker actions (spec section 2) and the roles allowed to approve each.
 * The requester can never approve their own request.
 */
export const APPROVAL_TYPES = [
  'IMMOBILISE',
  'RESTORE',
  'RECOVER',
  'VARIATION',
  'REFUND',
  'WRITE_OFF',
  'PAYMENT_EDIT',
  'BATTERY_RETIRE',
  'COST_FLOOR_EXCEPTION',
] as const;

export type ApprovalType = (typeof APPROVAL_TYPES)[number];

export const APPROVER_ROLES: Record<ApprovalType, readonly Role[]> = {
  IMMOBILISE: ['OPERATIONS_MANAGER', 'SUPER_ADMIN'],
  RESTORE: ['OPERATIONS_MANAGER', 'SUPER_ADMIN'],
  RECOVER: ['OPERATIONS_MANAGER', 'SUPER_ADMIN'],
  VARIATION: ['OPERATIONS_MANAGER', 'SUPER_ADMIN'],
  REFUND: ['FINANCE', 'SUPER_ADMIN'],
  WRITE_OFF: ['FINANCE', 'SUPER_ADMIN'],
  PAYMENT_EDIT: ['FINANCE', 'SUPER_ADMIN'],
  BATTERY_RETIRE: ['OPERATIONS_MANAGER', 'SUPER_ADMIN'],
  COST_FLOOR_EXCEPTION: ['PLAN_MANAGER', 'SUPER_ADMIN'],
};

export function canApprove(input: {
  type: ApprovalType;
  requesterId: string;
  approverId: string;
  approverRole: Role;
}): boolean {
  if (input.requesterId === input.approverId) return false;
  return APPROVER_ROLES[input.type].includes(input.approverRole);
}

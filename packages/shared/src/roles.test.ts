import { describe, expect, it } from 'vitest';
import {
  APPROVAL_TYPES,
  FIELD_ROLES,
  HEAD_OFFICE_ROLES,
  PERMISSIONS,
  ROLES,
  ROLE_PERMISSIONS,
  canApprove,
  hasPermission,
} from './roles';

describe('role permissions (spec section 2)', () => {
  it('gives every role a permission list made only of known permissions', () => {
    for (const role of ROLES) {
      for (const p of ROLE_PERMISSIONS[role]) expect(PERMISSIONS).toContain(p);
    }
  });

  it('splits roles between the admin panel and the Field App', () => {
    for (const role of HEAD_OFFICE_ROLES)
      expect(hasPermission(role, 'admin_panel.access')).toBe(true);
    for (const role of FIELD_ROLES) {
      expect(hasPermission(role, 'admin_panel.access')).toBe(false);
      expect(hasPermission(role, 'field_app.access')).toBe(true);
    }
  });

  it('lets only the super admin manage staff', () => {
    const managers = ROLES.filter((r) => hasPermission(r, 'staff.manage'));
    expect(managers).toEqual(['SUPER_ADMIN']);
  });

  it('stops field agents changing plan terms (D26)', () => {
    expect(hasPermission('FIELD_AGENT', 'plans.manage')).toBe(false);
  });

  it('lets field agents record installations, picking from batteries in stock', () => {
    expect(hasPermission('FIELD_AGENT', 'installations.record')).toBe(true);
    expect(hasPermission('FIELD_AGENT', 'batteries.read')).toBe(true);
    expect(hasPermission('FIELD_AGENT', 'batteries.manage')).toBe(false);
  });

  it('has installations by field agents and technicians verified by head office', () => {
    for (const r of ['SUPER_ADMIN', 'OPERATIONS_MANAGER', 'PLAN_MANAGER'] as const) {
      expect(hasPermission(r, 'installations.verify')).toBe(true);
    }
    for (const r of ['FIELD_AGENT', 'TECHNICIAN', 'FINANCE', 'SUPPORT'] as const) {
      expect(hasPermission(r, 'installations.verify')).toBe(false);
    }
  });

  it('stops operations managers editing payments', () => {
    expect(hasPermission('OPERATIONS_MANAGER', 'payments.record')).toBe(false);
  });

  it('stops finance changing plans', () => {
    expect(hasPermission('FINANCE', 'plans.manage')).toBe(false);
  });

  it('stops support seeing full ID numbers or approving anything', () => {
    expect(hasPermission('SUPPORT', 'kyc.view_full')).toBe(false);
    expect(hasPermission('SUPPORT', 'approvals.decide')).toBe(false);
  });

  it('stops technicians collecting payments', () => {
    expect(hasPermission('TECHNICIAN', 'payments.collect_cash')).toBe(false);
  });

  it('limits recovery staff to recording a recovery', () => {
    expect(ROLE_PERMISSIONS.RECOVERY).toEqual([
      'field_app.access',
      'agreements.read',
      'recovery.record',
    ]);
  });
});

describe('maker-checker (D19)', () => {
  it('never lets anyone approve their own request, including the super admin', () => {
    for (const type of APPROVAL_TYPES) {
      expect(
        canApprove({ type, requesterId: 'a', approverId: 'a', approverRole: 'SUPER_ADMIN' }),
      ).toBe(false);
    }
  });

  it('lets a second, eligible person approve', () => {
    expect(
      canApprove({
        type: 'IMMOBILISE',
        requesterId: 'a',
        approverId: 'b',
        approverRole: 'OPERATIONS_MANAGER',
      }),
    ).toBe(true);
    expect(
      canApprove({ type: 'REFUND', requesterId: 'a', approverId: 'b', approverRole: 'FINANCE' }),
    ).toBe(true);
  });

  it('rejects an approver whose role does not cover the action', () => {
    expect(
      canApprove({
        type: 'REFUND',
        requesterId: 'a',
        approverId: 'b',
        approverRole: 'OPERATIONS_MANAGER',
      }),
    ).toBe(false);
    expect(
      canApprove({
        type: 'IMMOBILISE',
        requesterId: 'a',
        approverId: 'b',
        approverRole: 'SUPPORT',
      }),
    ).toBe(false);
  });
});

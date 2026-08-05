import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { type ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import { RolesGuard } from './roles.guard';
import { PERMISSION_KEY } from './roles.decorator';

type Profile = {
  role: string;
  canonical: boolean;
  platformOnly: boolean;
  scopeType: 'merchant' | 'location' | 'platform';
  permissions: string[];
  approvalPermissions: string[];
  crossOperatorPermissions: string[];
  crossLocationPermissions: string[];
  policyDependencies: string[];
  entitlementDependency: string | null;
  justification: string;
};

type GrantMatrix = {
  schemaVersion: number;
  entitlement: string;
  roleAssignmentPolicy: Record<string, string[]>;
  profiles: Profile[];
};

const root = resolve(__dirname, '../../../../..');
const loadJson = <T>(path: string): T => JSON.parse(readFileSync(resolve(root, path), 'utf8')) as T;

describe('Gate 3D.1 pilot RBAC matrix', () => {
  const matrix = loadJson<GrantMatrix>('config/umipos-pilot-role-grants.json');
  const inventory = loadJson<{
    permissions: Array<{ key: string; profiles: string[]; seedGap: boolean }>;
  }>('config/umipos-permission-inventory.json');
  const approvals = loadJson<{
    boundaries: Array<{
      action: string;
      actingPermission: string;
      approvalPermission: string;
      selfApproval: boolean;
      fingerprintBound: boolean;
    }>;
  }>('config/umipos-pilot-approval-boundaries.json');

  const profile = (role: string) => matrix.profiles.find((value) => value.role === role)!;
  const permissions = (role: string) => profile(role).permissions;
  const executePermission = (role: string, permission: string) => {
    const reflector = {
      getAllAndOverride: (key: string) => (key === PERMISSION_KEY ? permission : undefined),
    } as unknown as Reflector;
    const context = {
      getHandler: () => () => undefined,
      getClass: () => class {},
      switchToHttp: () => ({
        getRequest: () => ({
          merchantAccess: { roles: [role], permissions: permissions(role) },
        }),
      }),
    } as unknown as ExecutionContext;
    return () => new RolesGuard(reflector).canActivate(context);
  };

  it('uses one deterministic, duplicate-free permission vocabulary', () => {
    const known = inventory.permissions.map((permission) => permission.key);
    expect(known).toEqual([...known].sort());
    expect(new Set(known).size).toBe(known.length);

    for (const value of matrix.profiles) {
      const grants = value.permissions;
      expect(grants).toEqual([...grants].sort());
      expect(new Set(grants).size).toBe(grants.length);
      expect(grants.every((permission) => known.includes(permission))).toBe(true);
      expect(grants).not.toContain('*');
    }
  });

  it('keeps the permission inventory synchronized with the profile matrix', () => {
    for (const permission of inventory.permissions) {
      const expectedProfiles = matrix.profiles
        .filter((value) => !value.platformOnly && value.permissions.includes(permission.key))
        .map((value) => value.role)
        .sort();
      expect(permission.profiles).toEqual(expectedProfiles);
      expect(permission.seedGap).toBe(false);
    }
  });

  it('defines the complete pilot profile set and keeps super_admin platform-only', () => {
    expect(matrix.entitlement).toBe('pos');
    expect(matrix.profiles.map((value) => value.role)).toEqual([
      'admin',
      'cashier',
      'manager',
      'owner',
      'staff',
      'super_admin',
      'supervisor',
      'viewer',
    ]);
    expect(profile('super_admin')).toMatchObject({ canonical: true, platformOnly: true });
    expect(profile('super_admin').permissions).toEqual([]);
  });

  it('lets Cashier complete a normal shift without administrative or approval grants', () => {
    expect(permissions('cashier')).toEqual(
      expect.arrayContaining([
        'catalog.read',
        'cart.write',
        'checkout.commit',
        'sale.lifecycle',
        'cash.register.use',
        'cash.shift.open',
        'cash.count.submit',
        'cash.reconcile',
        'cash.shift.close',
      ]),
    );
    expect(permissions('cashier')).not.toEqual(
      expect.arrayContaining([
        'merchant.manage',
        'device.enroll',
        'audit.read',
        'checkout.discount.approve',
        'cash.variance.approve',
        'sale.refund.approve',
      ]),
    );
  });

  it('keeps Supervisor location-bound and Manager below platform authority', () => {
    expect(permissions('supervisor')).toEqual(
      expect.arrayContaining(['sale.resume.any', 'checkout.discount.approve']),
    );
    expect(permissions('supervisor')).not.toContain('cash.variance.approve');
    expect(permissions('supervisor')).not.toContain('sale.refund.approve');
    expect(permissions('supervisor')).not.toContain('cash.movement.paid_out.approve');
    expect(profile('supervisor').crossLocationPermissions).toEqual([]);
    expect(permissions('manager')).toEqual(
      expect.arrayContaining([
        'sale.refund.full',
        'sale.refund.cash',
        'sale.refund.reconcile',
        'cash.movement.paid_out.approve',
        'cash.shift.close.approve',
      ]),
    );
    expect(permissions('manager')).not.toContain('merchant.manage');
    expect(permissions('manager')).not.toContain('device.enroll');
  });

  it('defines Staff as the explicit compatibility profile for Cashier', () => {
    expect(permissions('staff')).toEqual(permissions('cashier'));
  });

  it('keeps Viewer read-only', () => {
    expect(permissions('viewer')).toEqual(['catalog.read', 'insights.read']);
  });

  it('executes each canonical role journey through the real API permission guard', () => {
    const journeys: Record<string, string[]> = {
      cashier: [
        'catalog.read',
        'cart.write',
        'sale.lifecycle',
        'checkout.commit',
        'cash.shift.open',
        'cash.movement.paid_in',
        'cash.count.submit',
        'cash.reconcile',
        'cash.shift.close',
      ],
      supervisor: [
        'sale.resume.any',
        'checkout.recover.any',
        'checkout.discount.approve',
        'cash.count.recount',
        'sale.exception.history',
      ],
      manager: [
        'checkout.recover.any',
        'cash.variance.approve',
        'cash.shift.close.approve',
        'sale.refund.approve',
        'sale.refund.manual_terminal',
      ],
      owner: ['merchant.manage', 'device.enroll', 'audit.read', 'sale.refund.approve'],
      admin: ['merchant.manage', 'device.enroll', 'audit.read', 'cash.variance.approve'],
      viewer: ['catalog.read', 'insights.read'],
    };

    for (const [role, steps] of Object.entries(journeys)) {
      for (const permission of steps) {
        expect(executePermission(role, permission)()).toBe(true);
      }
    }

    for (const permission of [
      'cart.write',
      'checkout.commit',
      'cash.shift.open',
      'cash.movement.paid_in',
      'sale.refund.partial',
      'merchant.manage',
    ]) {
      expect(executePermission('viewer', permission)).toThrow(ForbiddenException);
    }
    expect(executePermission('cashier', 'checkout.discount.approve')).toThrow(ForbiddenException);
    expect(executePermission('supervisor', 'cash.variance.approve')).toThrow(ForbiddenException);
    expect(executePermission('manager', 'merchant.manage')).toThrow(ForbiddenException);
  });

  it('keeps role assignment below Owner and excludes super_admin', () => {
    expect(matrix.roleAssignmentPolicy.owner).not.toContain('owner');
    expect(matrix.roleAssignmentPolicy.owner).not.toContain('super_admin');
    expect(matrix.roleAssignmentPolicy.admin).not.toContain('admin');
    expect(matrix.roleAssignmentPolicy.admin).not.toContain('owner');
    expect(matrix.roleAssignmentPolicy.admin).not.toContain('super_admin');
    expect(matrix.roleAssignmentPolicy.admin).toContain('supervisor');
  });

  it('denies self-approval and binds every sensitive approval to a fingerprint', () => {
    expect(approvals.boundaries.length).toBeGreaterThanOrEqual(12);
    expect(approvals.boundaries.every((boundary) => !boundary.selfApproval)).toBe(true);
    expect(approvals.boundaries.every((boundary) => boundary.fingerprintBound)).toBe(true);
    expect(
      approvals.boundaries.every(
        (boundary) => boundary.actingPermission !== boundary.approvalPermission,
      ),
    ).toBe(true);
  });

  it('keeps the generated SQL synchronized with the canonical matrix', () => {
    const sql = readFileSync(
      resolve(root, 'docs/migration/build-v3/35_pos_pilot_rbac.sql'),
      'utf8',
    );
    expect(sql).toContain('GENERATED FROM config/umipos-pilot-role-grants.json');
    expect(sql).not.toContain('cross join umi.permission');
    expect(sql).toContain("'cash.movement.paid_out.approve'");
    for (const value of matrix.profiles.filter((item) => !item.platformOnly)) {
      expect(sql).toContain(`('${value.role}',`);
      for (const permission of value.permissions) {
        expect(sql).toContain(`('${value.role}','${permission}')`);
      }
    }
  });

  it('uses permission checks for device management and approval actors', () => {
    const devices = readFileSync(
      resolve(root, 'apps/umi-api/src/modules/devices/devices.controller.ts'),
      'utf8',
    );
    const entry = readFileSync(
      resolve(root, 'apps/umi-api/src/modules/pos-entry/pos-entry.repository.ts'),
      'utf8',
    );
    const cash = readFileSync(
      resolve(root, 'apps/umi-api/src/modules/pos-cash/pos-cash.repository.ts'),
      'utf8',
    );
    const staff = readFileSync(
      resolve(root, 'apps/umi-api/src/modules/staff/staff.controller.ts'),
      'utf8',
    );
    expect(devices).toContain("@RequirePermission('device.enroll')");
    expect(devices).toContain("@RequireProduct('pos')");
    expect(devices).not.toContain('@Roles(');
    expect(staff).toContain("@RequireProduct('pos')");
    expect(entry).not.toContain("r.key IN ('owner','admin','manager','supervisor','super_admin')");
    expect(entry).toContain("ee.feature_key='pos' AND ee.enabled");
    expect(entry).toContain('AND ms.id = $6::uuid');
    expect(entry).toContain('acting.durable_session_id=$7::uuid');
    expect(entry).toContain('acting.device_id=$8::uuid');
    expect(cash).toContain('`cash.movement.${dto.type}.approve`');
    expect(cash).toContain("permission: 'cash.shift.close.approve'");
  });
});

import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { PERMISSION_KEY, ROLES_KEY } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CashController } from './cash.controller';
import { CashMerchantController } from './cash-merchant.controller';
import { CashWriteController } from './cash-write.controller';
import { CashScanController } from './cash-scan.controller';

type Profile = { role: string; permissions: string[] };
type Matrix = { profiles: Profile[] };

const root = resolve(__dirname, '../../../../..');
const matrix = JSON.parse(
  readFileSync(resolve(root, 'config/umipos-pilot-role-grants.json'), 'utf8'),
) as Matrix;

const held = (role: string): string[] => {
  const profile = matrix.profiles.find((entry) => entry.role === role);
  if (!profile) throw new Error(`the grant matrix has no profile for ${role}`);
  return profile.permissions;
};

const permissionOf = (controller: { prototype: object }, handler: string): string | null =>
  Reflect.getMetadata(
    PERMISSION_KEY,
    (controller.prototype as Record<string, unknown>)[handler] as object,
  ) ?? null;

/** Run the real RolesGuard against a synthetic membership with the seeded grants. */
const allows = (role: string, permission: string): boolean => {
  const reflector = {
    getAllAndOverride: (key: string) => (key === PERMISSION_KEY ? permission : undefined),
  } as unknown as Reflector;
  const context = {
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({
      getRequest: () => ({ merchantAccess: { roles: [role], permissions: held(role) } }),
    }),
  } as unknown as ExecutionContext;
  return new RolesGuard(reflector).canActivate(context);
};

describe('Cash action permissions', () => {
  it('names a permission on every register action and keeps the guard stack', () => {
    const expected: ReadonlyArray<[{ prototype: object }, string, string]> = [
      [CashController, 'getStats', 'loyalty.read'],
      [CashController, 'getAnalytics', 'insights.read'],
      [CashController, 'getCustomers', 'loyalty.read'],
      [CashController, 'getCustomer', 'loyalty.read'],
      [CashController, 'exportCustomers', 'customer.contact.read'],
      [CashController, 'getGiftCards', 'gift_card.read'],
      [CashMerchantController, 'getStats', 'loyalty.read'],
      [CashMerchantController, 'getAnalytics', 'insights.read'],
      [CashMerchantController, 'getCustomers', 'loyalty.read'],
      [CashMerchantController, 'getCustomer', 'loyalty.read'],
      [CashMerchantController, 'getMembers', 'loyalty.read'],
      [CashMerchantController, 'getMember', 'loyalty.read'],
      [CashMerchantController, 'registerMember', 'customer.create'],
      [CashMerchantController, 'getGiftCards', 'gift_card.read'],
      [CashMerchantController, 'getSettings', 'merchant.manage'],
      [CashMerchantController, 'updateSettings', 'merchant.manage'],
      [CashWriteController, 'topup', 'wallet.authorize'],
      [CashWriteController, 'purchase', 'wallet.redeem'],
      [CashWriteController, 'issueGiftCard', 'gift_card.issue'],
      [CashScanController, 'run', 'loyalty.reward.redeem'],
      [CashScanController, 'preview', 'loyalty.reward.redeem'],
      [CashScanController, 'seals', 'loyalty.adjust'],
    ];
    for (const [controller, handler, permission] of expected) {
      expect(permissionOf(controller, handler), `${handler} permission`).toBe(permission);
    }

    for (const controller of [CashController, CashMerchantController, CashWriteController, CashScanController]) {
      const guards = (Reflect.getMetadata(GUARDS_METADATA, controller) ?? []) as unknown[];
      expect(guards).toContain(RolesGuard);
    }
  });

  it('removes the role list that refused a cashier on scan, topup and purchase', () => {
    expect(Reflect.getMetadata(ROLES_KEY, CashWriteController)).toBeUndefined();
    expect(Reflect.getMetadata(ROLES_KEY, CashScanController)).toBeUndefined();
    // The register's own error sink keeps its role gate: it is not an action, and
    // a cashier operates the register that reports the failure.
    const sinkRoles = Reflect.getMetadata(
      ROLES_KEY,
      CashController.prototype.reportClientError,
    ) as string[];
    expect(sinkRoles).toContain('staff');
    expect(sinkRoles).toContain('cashier');
  });

  it('lets the real guard decide the measured negative and positive cases', () => {
    // Cashier keeps the till and loses the administrative actions.
    expect(allows('cashier', 'loyalty.read')).toBe(true);
    expect(allows('cashier', 'loyalty.reward.redeem')).toBe(true);
    expect(allows('cashier', 'wallet.authorize')).toBe(true);
    expect(allows('cashier', 'wallet.redeem')).toBe(true);
    expect(() => allows('cashier', 'insights.read')).toThrow();
    expect(() => allows('cashier', 'customer.contact.read')).toThrow();
    expect(() => allows('cashier', 'gift_card.issue')).toThrow();
    expect(() => allows('cashier', 'loyalty.adjust')).toThrow();

    // A viewer reads, and cannot act.
    expect(allows('viewer', 'insights.read')).toBe(true);
    expect(allows('viewer', 'loyalty.read')).toBe(true);
    expect(() => allows('viewer', 'loyalty.reward.redeem')).toThrow();
    expect(() => allows('viewer', 'wallet.authorize')).toThrow();

    // A manager can export and bulk-adjust, and cannot read analytics.
    expect(allows('manager', 'customer.contact.read')).toBe(true);
    expect(allows('manager', 'loyalty.adjust')).toBe(true);
    expect(() => allows('manager', 'insights.read')).toThrow();
  });

  it('matches the seeded grants for the actions this slice touches', () => {
    // Each row names the action and the permission the handler asks for. `true`
    // means the role holds it in the same matrix the live logins are seeded from.
    const cases: ReadonlyArray<[role: string, handler: string, permission: string, allowed: boolean]> = [
      ['cashier', 'scan', 'loyalty.reward.redeem', true],
      ['cashier', 'topup', 'wallet.authorize', true],
      ['cashier', 'purchase', 'wallet.redeem', true],
      ['cashier', 'seals', 'loyalty.adjust', false],
      ['cashier', 'gift issue', 'gift_card.issue', false],
      ['cashier', 'analytics', 'insights.read', false],
      ['cashier', 'export', 'customer.contact.read', false],
      ['cashier', 'members', 'loyalty.read', true],
      ['staff', 'scan', 'loyalty.reward.redeem', true],
      ['staff', 'topup', 'wallet.authorize', true],
      ['staff', 'seals', 'loyalty.adjust', false],
      ['staff', 'gift issue', 'gift_card.issue', false],
      ['staff', 'export', 'customer.contact.read', false],
      ['supervisor', 'scan', 'loyalty.reward.redeem', true],
      ['supervisor', 'export', 'customer.contact.read', true],
      ['supervisor', 'seals', 'loyalty.adjust', false],
      ['supervisor', 'gift issue', 'gift_card.issue', false],
      ['manager', 'seals', 'loyalty.adjust', true],
      ['manager', 'gift issue', 'gift_card.issue', true],
      ['manager', 'export', 'customer.contact.read', true],
      ['manager', 'analytics', 'insights.read', false],
      ['viewer', 'members', 'loyalty.read', true],
      ['viewer', 'analytics', 'insights.read', true],
      ['viewer', 'scan', 'loyalty.reward.redeem', false],
      ['viewer', 'topup', 'wallet.authorize', false],
      ['viewer', 'export', 'customer.contact.read', false],
      ['owner', 'seals', 'loyalty.adjust', true],
      ['owner', 'gift issue', 'gift_card.issue', true],
      ['owner', 'export', 'customer.contact.read', true],
      ['admin', 'analytics', 'insights.read', true],
    ];
    for (const [role, action, permission, allowed] of cases) {
      const has = held(role).includes(permission);
      expect(has, `${role} ${allowed ? 'must hold' : 'must not hold'} ${permission} for ${action}`).toBe(
        allowed,
      );
    }
  });
});

import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { DashboardOperationsQuery } from '@umi/contract';
import type { AuthUser, MerchantAccess } from '../auth/auth.types';
import { DashboardOperationsRepository } from './dashboard-operations.repository';
import { DASHBOARD_DOMAIN_POLICY, hasDashboardPermission } from './dashboard-operations.policy';

@Injectable()
export class DashboardOperationsService {
  constructor(private readonly repository: DashboardOperationsRepository) {}

  async snapshot(user: AuthUser, access: MerchantAccess, query: DashboardOperationsQuery) {
    const selected = DASHBOARD_DOMAIN_POLICY.find((entry) => entry.domain === query.domain);
    if (!selected || !hasDashboardPermission(access.permissions, selected.permissions)) {
      throw new ForbiddenException({ code: 'PERMISSION_DENIED' });
    }
    if (access.locationId && query.locationId && access.locationId !== query.locationId) {
      throw new ForbiddenException({ code: 'LOCATION_SCOPE_VIOLATION' });
    }
    const locationId = access.locationId ?? query.locationId ?? null;
    const rows = await this.repository.list(user.id, access.merchantId, query, locationId);
    const items = rows.slice(0, query.limit);
    const hasMore = rows.length > query.limit;
    return {
      merchantId: access.merchantId,
      locationId,
      scope: access.locationId
        ? 'assigned_location'
        : locationId
          ? 'selected_location'
          : 'merchant',
      domains: DASHBOARD_DOMAIN_POLICY.map((entry) => ({
        domain: entry.domain,
        label: entry.label,
        priority: entry.priority,
        available: hasDashboardPermission(access.permissions, entry.permissions),
        administrative: entry.administrative,
        boundary: entry.boundary,
        requiredPermissions: entry.permissions,
        allowedActions: entry.actions,
        recovery: entry.recovery,
      })),
      selectedDomain: query.domain,
      items,
      page: {
        limit: query.limit,
        hasMore,
        nextCursor: hasMore ? String(query.cursor + query.limit) : null,
      },
      capturedAt: new Date().toISOString(),
    };
  }

  /**
   * The drawer count policy of one location, for the switch on Caja y turnos.
   *
   * Reading needs the same authority as writing: this is the rule that decides
   * whether the till hides its own drawer, so a person who cannot set it does
   * not need to read it either. Null means the location holds no policy row,
   * and the screen then says so instead of inventing a default.
   */
  async cashPolicy(user: AuthUser, access: MerchantAccess, locationId: string | null) {
    if (!hasDashboardPermission(access.permissions, ['merchant.manage'])) {
      throw new ForbiddenException({ code: 'PERMISSION_DENIED' });
    }
    const scoped = this.scopedLocation(access, locationId);
    return this.repository.cashPolicy(access.merchantId, user.id, scoped);
  }

  /**
   * Sets the blind count of one location. The count method follows the flag, so
   * the till can never read a blind policy with a total-only count.
   */
  async setCashPolicy(
    user: AuthUser,
    access: MerchantAccess,
    locationId: string | null,
    blindCountRequired: boolean,
  ) {
    if (!hasDashboardPermission(access.permissions, ['merchant.manage'])) {
      throw new ForbiddenException({ code: 'PERMISSION_DENIED' });
    }
    const scoped = this.scopedLocation(access, locationId);
    const changed = await this.repository.setCashPolicy(
      access.merchantId,
      user.id,
      scoped,
      blindCountRequired,
    );
    if (!changed) throw new NotFoundException({ code: 'RESOURCE_NOT_FOUND' });
    return {
      blindCountRequired,
      countMethod: blindCountRequired ? 'denomination_or_total' : 'total_only',
    };
  }

  /** The location this call may touch, or a refusal. */
  async checkoutPolicy(user: AuthUser, access: MerchantAccess, locationId: string | null) {
    if (!hasDashboardPermission(access.permissions, ['merchant.manage'])) {
      throw new ForbiddenException({ code: 'PERMISSION_DENIED' });
    }
    return this.repository.checkoutPolicy(
      access.merchantId,
      user.id,
      this.scopedLocation(access, locationId),
    );
  }

  async setCheckoutPolicy(
    user: AuthUser,
    access: MerchantAccess,
    locationId: string | null,
    policy: {
      manualTerminalEnabled: boolean;
      bankTransferEnabled: boolean;
      bankTransferDetails: {
        holderName: string;
        bankName: string;
        clabe?: string | null;
        accountNumber?: string | null;
      } | null;
      mixedTenderEnabled: boolean;
      allowDineInWithoutTable: boolean;
      tipAttribution: 'account_owner' | 'payment_processor';
    },
  ) {
    if (!hasDashboardPermission(access.permissions, ['merchant.manage'])) {
      throw new ForbiddenException({ code: 'PERMISSION_DENIED' });
    }
    const result = await this.repository.setCheckoutPolicy(
      access.merchantId,
      user.id,
      this.scopedLocation(access, locationId),
      policy,
    );
    if (!result) throw new NotFoundException({ code: 'RESOURCE_NOT_FOUND' });
    return result;
  }

  /** The location this call may touch, or a refusal. */
  private scopedLocation(access: MerchantAccess, locationId: string | null): string {
    const scoped = locationId ?? access.locationId ?? null;
    if (!scoped) throw new ForbiddenException({ code: 'LOCATION_SCOPE_VIOLATION' });
    if (access.locationId && access.locationId !== scoped) {
      throw new ForbiddenException({ code: 'LOCATION_SCOPE_VIOLATION' });
    }
    if (!/^[0-9a-fA-F-]{36}$/.test(scoped)) {
      throw new NotFoundException({ code: 'RESOURCE_NOT_FOUND' });
    }
    return scoped;
  }

  // The sale detail = its receipt snapshot. Gated by the same `sales` permission as
  // the list, and by the caller's location scope. Read-only.
  async saleReceipt(user: AuthUser, access: MerchantAccess, saleId: string) {
    const selected = DASHBOARD_DOMAIN_POLICY.find((entry) => entry.domain === 'sales');
    if (!selected || !hasDashboardPermission(access.permissions, selected.permissions)) {
      throw new ForbiddenException({ code: 'PERMISSION_DENIED' });
    }
    if (!/^[0-9a-fA-F-]{36}$/.test(saleId)) {
      throw new NotFoundException({ code: 'RESOURCE_NOT_FOUND' });
    }
    const row = await this.repository.saleReceipt(
      user.id,
      access.merchantId,
      saleId,
      access.locationId ?? null,
    );
    if (!row) {
      throw new NotFoundException({ code: 'RESOURCE_NOT_FOUND' });
    }
    if (access.locationId && row.locationId && row.locationId !== access.locationId) {
      throw new ForbiddenException({ code: 'LOCATION_SCOPE_VIOLATION' });
    }
    return { receiptNumber: row.receiptNumber, snapshot: row.snapshot, exceptions: row.exceptions };
  }

  // The reconciliation drill-down for one cash shift. Gated by the same `cash_shifts`
  // permission as the shift list, and by the caller's location scope. Read-only.
  async cashShiftDetail(user: AuthUser, access: MerchantAccess, shiftId: string) {
    const selected = DASHBOARD_DOMAIN_POLICY.find((entry) => entry.domain === 'cash_shifts');
    if (!selected || !hasDashboardPermission(access.permissions, selected.permissions)) {
      throw new ForbiddenException({ code: 'PERMISSION_DENIED' });
    }
    if (!/^[0-9a-fA-F-]{36}$/.test(shiftId)) {
      throw new NotFoundException({ code: 'RESOURCE_NOT_FOUND' });
    }
    const row = await this.repository.cashShiftDetail(
      user.id,
      access.merchantId,
      shiftId,
      access.locationId ?? null,
    );
    if (!row) {
      throw new NotFoundException({ code: 'RESOURCE_NOT_FOUND' });
    }
    return row;
  }
}

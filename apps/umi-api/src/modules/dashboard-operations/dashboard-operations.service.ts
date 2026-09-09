import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { DashboardOperationsQuery, ReportsSalesQuery } from '@umi/contract';
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

  // The Reportes → Ventas aggregate. Gated by the same `sales` permission as the sales
  // list, and by the caller's location scope. Read-only.
  async salesSummary(user: AuthUser, access: MerchantAccess, query: ReportsSalesQuery) {
    const selected = DASHBOARD_DOMAIN_POLICY.find((entry) => entry.domain === 'sales');
    if (!selected || !hasDashboardPermission(access.permissions, selected.permissions)) {
      throw new ForbiddenException({ code: 'PERMISSION_DENIED' });
    }
    if (access.locationId && query.locationId && access.locationId !== query.locationId) {
      throw new ForbiddenException({ code: 'LOCATION_SCOPE_VIOLATION' });
    }
    const locationId = access.locationId ?? query.locationId ?? null;
    return this.repository.salesSummary(user.id, access.merchantId, query, locationId);
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

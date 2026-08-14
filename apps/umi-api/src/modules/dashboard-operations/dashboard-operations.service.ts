import { ForbiddenException, Injectable } from '@nestjs/common';
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
}

import { ForbiddenException, Injectable } from '@nestjs/common';
import { MetricsResponse, type MetricsQueryInput } from '@umi/contract';
import type { AuthUser, MerchantAccess } from '../auth/auth.types';
import {
  DASHBOARD_DOMAIN_POLICY,
  hasDashboardPermission,
} from '../dashboard-operations/dashboard-operations.policy';
import { MetricsRepository } from './metrics.repository';

/**
 * The semantic analytics read. It reuses the `sales` policy of the dashboard:
 * the sales domain owns this read, and this route adds no permission.
 */
@Injectable()
export class MetricsService {
  constructor(private readonly repository: MetricsRepository) {}

  async query(user: AuthUser, access: MerchantAccess, query: MetricsQueryInput) {
    const selected = DASHBOARD_DOMAIN_POLICY.find((entry) => entry.domain === 'sales');
    if (!selected || !hasDashboardPermission(access.permissions, selected.permissions)) {
      throw new ForbiddenException({ code: 'PERMISSION_DENIED' });
    }
    if (access.locationId && query.locationId && access.locationId !== query.locationId) {
      throw new ForbiddenException({ code: 'LOCATION_SCOPE_VIOLATION' });
    }
    const locationId = access.locationId ?? query.locationId ?? null;
    const result = await this.repository.read(user.id, access.merchantId, locationId, query);
    return MetricsResponse.parse(result);
  }
}

import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  AuditEventView,
  AuditSearchRequest,
  AuditSearchResponse,
  type AuditSearchRequest as AuditSearchInput,
} from '@umi/contract';
import { ZodValidationPipe } from '../../shared/http/zod-validation.pipe';
import { AuthGuard } from '../auth/auth.guard';
import { TenantAccessGuard } from '../auth/tenant-access.guard';
import { Tenant } from '../auth/current-user.decorator';
import type { TenantAccess } from '../auth/auth.types';
import { RequirePermission } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { IntegrityRepository } from './integrity.repository';

@UseGuards(AuthGuard, TenantAccessGuard, RolesGuard)
@Controller('api/tenants/:tenantId/audit')
export class IntegrityController {
  constructor(private readonly repository: IntegrityRepository) {}

  @Get()
  @RequirePermission('audit.read')
  async search(
    @Tenant() tenant: TenantAccess,
    @Query(new ZodValidationPipe(AuditSearchRequest)) query: AuditSearchInput,
  ) {
    const rows = await this.repository.searchAudit(tenant.tenantId, {
      ...query,
      limit: query.limit + 1,
    });
    const hasMore = rows.length > query.limit;
    const events = rows.slice(0, query.limit).map((event) => AuditEventView.parse(event));
    return AuditSearchResponse.parse({
      events,
      page: {
        limit: query.limit,
        hasMore,
        nextCursor: hasMore ? (events.at(-1)?.occurredAt ?? null) : null,
      },
    });
  }
}

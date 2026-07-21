import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { TenantAccessGuard } from '../auth/tenant-access.guard';
import { Tenant } from '../auth/current-user.decorator';
import type { TenantAccess } from '../auth/auth.types';
import { CustomersService } from './customers.service';

/**
 * Tenant-wide conversation list (admin view). Slug-routed + membership-checked;
 * no product gate, matching server.js. Reads `tenant.conversation` + `tenant.customer`.
 */
@UseGuards(AuthGuard, TenantAccessGuard)
@Controller('api/:slug/admin/conversations')
export class ConversationsController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  list(@Tenant() tenant: TenantAccess, @Query() query: Record<string, string>) {
    return this.customers.conversationsList(tenant.tenantId, query);
  }
}

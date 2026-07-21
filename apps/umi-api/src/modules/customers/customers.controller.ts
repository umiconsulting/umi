import { Controller, Get, NotFoundException, Param, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { TenantAccessGuard } from '../auth/tenant-access.guard';
import { EntitlementGuard } from '../auth/entitlement.guard';
import { RequireProduct } from '../auth/require-product.decorator';
import { Tenant } from '../auth/current-user.decorator';
import type { TenantAccess } from '../auth/auth.types';
import { CustomersService } from './customers.service';

/**
 * Customer 360 reads (gated on the `dashboard` product). The composite detail
 * is assembled from per-domain loaders; the list uses the efficient lateral-join
 * rollup (see customers.repository).
 */
@UseGuards(AuthGuard, TenantAccessGuard, EntitlementGuard)
@RequireProduct('dashboard')
@Controller('api/tenants/:tenantId')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get('customers')
  async list(@Tenant() tenant: TenantAccess, @Query() query: Record<string, string>) {
    const products = await this.customers.loadProducts(tenant.tenantId);
    return this.customers.list(tenant.tenantId, products, query);
  }

  @Get('customers/:contactId')
  async detail(@Tenant() tenant: TenantAccess, @Param('contactId') contactId: string) {
    const products = await this.customers.loadProducts(tenant.tenantId);
    const detail = await this.customers.detail(tenant.tenantId, products, contactId);
    if (!detail) throw new NotFoundException({ error: 'customer_not_found' });
    return detail;
  }

  @Get('customers/:contactId/timeline')
  async timeline(@Tenant() tenant: TenantAccess, @Param('contactId') contactId: string) {
    return { timeline: await this.customers.timeline(tenant.tenantId, contactId) };
  }

  @Get('customers/:contactId/conversations')
  async conversations(@Tenant() tenant: TenantAccess, @Param('contactId') contactId: string) {
    return {
      conversations: await this.customers.conversations(tenant.tenantId, contactId),
    };
  }

  @Get('customers/:contactId/orders')
  async orders(@Tenant() tenant: TenantAccess, @Param('contactId') contactId: string) {
    return { orders: await this.customers.orders(tenant.tenantId, contactId) };
  }

  @Get('customers/:contactId/cash')
  async cash(@Tenant() tenant: TenantAccess, @Param('contactId') contactId: string) {
    const products = await this.customers.loadProducts(tenant.tenantId);
    return this.customers.cash(tenant.tenantId, products, contactId);
  }

  @Get('customers/:contactId/identity')
  async identity(@Tenant() tenant: TenantAccess, @Param('contactId') contactId: string) {
    return this.customers.identity(tenant.tenantId, contactId);
  }

  @Get('insights/customer-platform')
  async insights(@Tenant() tenant: TenantAccess) {
    const products = await this.customers.loadProducts(tenant.tenantId);
    return this.customers.insights(tenant.tenantId, products);
  }
}

import { Controller, Get, NotFoundException, Param, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { MerchantAccessGuard } from '../auth/merchant-access.guard';
import { EntitlementGuard } from '../auth/entitlement.guard';
import { RolesGuard } from '../auth/roles.guard';
import { RequirePermission } from '../auth/roles.decorator';
import { RequireProduct } from '../auth/require-product.decorator';
import { Merchant } from '../auth/current-user.decorator';
import type { MerchantAccess } from '../auth/auth.types';
import { CustomersService } from './customers.service';

/**
 * Customer 360 reads (gated on the `dashboard` product). The composite detail
 * is assembled from per-domain loaders; the list uses the efficient lateral-join
 * rollup (see customers.repository).
 *
 * `customer.read` on every handler (workstream C: "the client hides; the API
 * decides"). Both Dashboard modules that read this controller — `customers`
 * (Clientes) and `triage` (Atención) in `module-registry.js` — gate on exactly
 * that permission, so the API is now as strict as the screens and no stricter.
 * Before this, the product gate was the only gate: any role holding the
 * `dashboard` entitlement could read every customer record whatever its
 * permissions said. That is latent today — every profile in
 * `config/umipos-pilot-role-grants.json` either holds `customer.read` or carries
 * the `*` wildcard — and live the moment a role holds neither.
 *
 * The till is not on this path: the POS customer search is
 * `GET /api/v1/pos/merchants/:merchantId/customers`
 * (pos-customer-value.controller.ts) on the device-credential stack, and stays
 * untouched.
 */
@UseGuards(AuthGuard, MerchantAccessGuard, EntitlementGuard, RolesGuard)
@RequireProduct('dashboard')
@Controller('api/merchants/:merchantId')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get('customers')
  // Mirrors the Dashboard `customers` module (module-registry.js: ['customer.read']).
  @RequirePermission('customer.read')
  async list(@Merchant() merchant: MerchantAccess, @Query() query: Record<string, string>) {
    const products = await this.customers.loadProducts(merchant.merchantId);
    return this.customers.list(merchant.merchantId, products, query);
  }

  @Get('customers/:contactId')
  @RequirePermission('customer.read')
  async detail(@Merchant() merchant: MerchantAccess, @Param('contactId') contactId: string) {
    const products = await this.customers.loadProducts(merchant.merchantId);
    const detail = await this.customers.detail(merchant.merchantId, products, contactId);
    if (!detail) throw new NotFoundException({ error: 'customer_not_found' });
    return detail;
  }

  @Get('customers/:contactId/timeline')
  @RequirePermission('customer.read')
  async timeline(@Merchant() merchant: MerchantAccess, @Param('contactId') contactId: string) {
    return { timeline: await this.customers.timeline(merchant.merchantId, contactId) };
  }

  @Get('customers/:contactId/conversations')
  @RequirePermission('customer.read')
  async conversations(@Merchant() merchant: MerchantAccess, @Param('contactId') contactId: string) {
    return {
      conversations: await this.customers.conversations(merchant.merchantId, contactId),
    };
  }

  @Get('customers/:contactId/orders')
  @RequirePermission('customer.read')
  async orders(@Merchant() merchant: MerchantAccess, @Param('contactId') contactId: string) {
    return { orders: await this.customers.orders(merchant.merchantId, contactId) };
  }

  @Get('customers/:contactId/conversations/:conversationId/messages')
  @RequirePermission('customer.read')
  async messages(
    @Merchant() merchant: MerchantAccess,
    @Param('contactId') contactId: string,
    @Param('conversationId') conversationId: string,
    @Query() query: Record<string, string>,
  ) {
    return this.customers.messages(merchant.merchantId, contactId, conversationId, {
      cursor: query.cursor,
      limit: query.limit,
    });
  }

  @Get('customers/:contactId/cash')
  @RequirePermission('customer.read')
  async cash(@Merchant() merchant: MerchantAccess, @Param('contactId') contactId: string) {
    const products = await this.customers.loadProducts(merchant.merchantId);
    return this.customers.cash(merchant.merchantId, products, contactId);
  }

  @Get('customers/:contactId/identity')
  @RequirePermission('customer.read')
  async identity(@Merchant() merchant: MerchantAccess, @Param('contactId') contactId: string) {
    return this.customers.identity(merchant.merchantId, contactId);
  }

  /**
   * The AI customer portrait (Overview tab). Loaded lazily and separately from the
   * detail bundle so the Haiku call never slows the profile: the KPI tiles paint
   * from `detail`, and this fills the description card in when it is ready.
   */
  @Get('customers/:contactId/description')
  @RequirePermission('customer.read')
  async description(@Merchant() merchant: MerchantAccess, @Param('contactId') contactId: string) {
    return this.customers.describe(merchant.merchantId, contactId);
  }

  @Get('insights/customer-platform')
  // Read by the Clientes screen's header stats (`data.jsx useCustomerInsights`),
  // so it carries that module's permission: `customers` → ['customer.read'].
  @RequirePermission('customer.read')
  async insights(@Merchant() merchant: MerchantAccess) {
    const products = await this.customers.loadProducts(merchant.merchantId);
    return this.customers.insights(merchant.merchantId, products);
  }

  @Get('insights/triage')
  // Mirrors the Dashboard `triage` module (module-registry.js: ['customer.read']).
  @RequirePermission('customer.read')
  async triage(@Merchant() merchant: MerchantAccess, @Query() query: Record<string, string>) {
    return this.customers.triage(merchant.merchantId, { limit: query.limit });
  }
}

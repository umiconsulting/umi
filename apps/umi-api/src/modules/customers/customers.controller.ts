import { Controller, Get, NotFoundException, Param, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { MerchantAccessGuard } from '../auth/merchant-access.guard';
import { EntitlementGuard } from '../auth/entitlement.guard';
import { RequireProduct } from '../auth/require-product.decorator';
import { Merchant } from '../auth/current-user.decorator';
import type { MerchantAccess } from '../auth/auth.types';
import { CustomersService } from './customers.service';

/**
 * Customer 360 reads (gated on the `dashboard` product). The composite detail
 * is assembled from per-domain loaders; the list uses the efficient lateral-join
 * rollup (see customers.repository).
 */
@UseGuards(AuthGuard, MerchantAccessGuard, EntitlementGuard)
@RequireProduct('dashboard')
@Controller('api/merchants/:merchantId')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get('customers')
  async list(@Merchant() merchant: MerchantAccess, @Query() query: Record<string, string>) {
    const products = await this.customers.loadProducts(merchant.merchantId);
    return this.customers.list(merchant.merchantId, products, query);
  }

  @Get('customers/:contactId')
  async detail(@Merchant() merchant: MerchantAccess, @Param('contactId') contactId: string) {
    const products = await this.customers.loadProducts(merchant.merchantId);
    const detail = await this.customers.detail(merchant.merchantId, products, contactId);
    if (!detail) throw new NotFoundException({ error: 'customer_not_found' });
    return detail;
  }

  @Get('customers/:contactId/timeline')
  async timeline(@Merchant() merchant: MerchantAccess, @Param('contactId') contactId: string) {
    return { timeline: await this.customers.timeline(merchant.merchantId, contactId) };
  }

  @Get('customers/:contactId/conversations')
  async conversations(@Merchant() merchant: MerchantAccess, @Param('contactId') contactId: string) {
    return {
      conversations: await this.customers.conversations(merchant.merchantId, contactId),
    };
  }

  @Get('customers/:contactId/orders')
  async orders(@Merchant() merchant: MerchantAccess, @Param('contactId') contactId: string) {
    return { orders: await this.customers.orders(merchant.merchantId, contactId) };
  }

  @Get('customers/:contactId/cash')
  async cash(@Merchant() merchant: MerchantAccess, @Param('contactId') contactId: string) {
    const products = await this.customers.loadProducts(merchant.merchantId);
    return this.customers.cash(merchant.merchantId, products, contactId);
  }

  @Get('customers/:contactId/identity')
  async identity(@Merchant() merchant: MerchantAccess, @Param('contactId') contactId: string) {
    return this.customers.identity(merchant.merchantId, contactId);
  }

  @Get('insights/customer-platform')
  async insights(@Merchant() merchant: MerchantAccess) {
    const products = await this.customers.loadProducts(merchant.merchantId);
    return this.customers.insights(merchant.merchantId, products);
  }
}

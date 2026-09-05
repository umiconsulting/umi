import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { MerchantAccessGuard } from '../auth/merchant-access.guard';
import { EntitlementGuard } from '../auth/entitlement.guard';
import { RolesGuard } from '../auth/roles.guard';
import { RequireProduct } from '../auth/require-product.decorator';
import { RequirePermission } from '../auth/roles.decorator';
import { Merchant } from '../auth/current-user.decorator';
import type { MerchantAccess } from '../auth/auth.types';
import { OrdersService } from './orders.service';

/**
 * The dashboard's own commercial order surface (ORDER_MODEL §1: the dashboard reads
 * `customer_order` directly). Gated on the `dashboard` product — the owner console —
 * and `kitchen.read`, the same permission the "Pedidos" module already required, so the
 * screen that is reachable can also read the data it needs. Advancing a status is the
 * write half of the same read; the guard is the one that opens the screen.
 */
@UseGuards(AuthGuard, MerchantAccessGuard, EntitlementGuard, RolesGuard)
@RequireProduct('dashboard')
@RequirePermission('kitchen.read')
@Controller('api/merchants/:merchantId/orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  list(
    @Merchant() t: MerchantAccess,
    @Query('filter') filter?: string,
    @Query('channel') channel?: string,
    @Query('locationId') locationId?: string,
  ) {
    return this.orders.listForDashboard(t.merchantId, filter, channel, locationId ?? null);
  }

  @Post(':orderId/transition')
  transition(
    @Merchant() t: MerchantAccess,
    @Param('orderId') orderId: string,
    @Body() body: Record<string, unknown>,
  ) {
    const target = typeof body.target_status === 'string' ? body.target_status : null;
    return this.orders.transitionFromDashboard(t.merchantId, orderId, target || '');
  }
}

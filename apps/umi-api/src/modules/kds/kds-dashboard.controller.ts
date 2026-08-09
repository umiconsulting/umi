import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { MerchantAccessGuard } from '../auth/merchant-access.guard';
import { EntitlementGuard } from '../auth/entitlement.guard';
import { RequireProduct } from '../auth/require-product.decorator';
import { CurrentUser, Merchant } from '../auth/current-user.decorator';
import type { AuthUser, MerchantAccess } from '../auth/auth.types';
import { KdsService } from './kds.service';

/**
 * Owner-facing KDS surface the dashboard SPA calls
 * (`/api/merchants/:merchantId/kds/*`). Cookie-authed + membership-checked +
 * `kds`-entitlement gated by the shared guard stack (same trust model as the
 * cash admin routes — no extra per-action permission). This replaces the legacy
 * `server.js` `callKdsPairingBackend` proxy: it dispatches to the in-process
 * `KdsService` directly. All routes honor `?locationId=`.
 */
@UseGuards(AuthGuard, MerchantAccessGuard, EntitlementGuard)
@RequireProduct('kds')
@Controller('api/merchants/:merchantId/kds')
export class KdsDashboardController {
  constructor(private readonly kds: KdsService) {}

  @Get('devices')
  listDevices(@Merchant() t: MerchantAccess, @Query('locationId') locationId?: string) {
    return this.kds.listDevicesForDashboard(t.merchantId, locationId ?? null);
  }

  @Get('orders')
  listOrders(
    @Merchant() t: MerchantAccess,
    @Query('filter') filter?: string,
    @Query('locationId') locationId?: string,
  ) {
    return this.kds.listOrdersForDashboard(t.merchantId, filter, locationId ?? null);
  }

  @Get('ticker')
  ticker(@Merchant() t: MerchantAccess) {
    return this.kds.tickerForDashboard(t.merchantId);
  }

  @Get('stations')
  listStations(@Merchant() t: MerchantAccess, @Query('locationId') locationId?: string) {
    return this.kds.listStationsForDashboard(t.merchantId, locationId ?? null);
  }

  @Post('stations')
  createStation(
    @Merchant() t: MerchantAccess,
    @Body() body: Record<string, unknown>,
    @Query('locationId') locationId?: string,
  ) {
    return this.kds.createStation(t.merchantId, locationId ?? null, body);
  }

  @Patch('stations/:stationId')
  updateStation(
    @Merchant() t: MerchantAccess,
    @Param('stationId') stationId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.kds.updateStation(t.merchantId, stationId, body);
  }

  @Delete('stations/:stationId')
  archiveStation(@Merchant() t: MerchantAccess, @Param('stationId') stationId: string) {
    return this.kds.archiveStation(t.merchantId, stationId);
  }

  @Get('devices/pairing')
  listPairings(@Merchant() t: MerchantAccess, @Query('locationId') locationId?: string) {
    return this.kds.listPairingsForDashboard(t.merchantId, locationId ?? null);
  }

  // provision + pairing-pin both create a pairing PIN (the SPA's "add device").
  @Post('devices/provision')
  provision(
    @Merchant() t: MerchantAccess,
    @Body() body: Record<string, unknown>,
    @Query('locationId') locationId?: string,
  ) {
    return this.kds.createPairing(t.merchantId, locationId ?? null, body);
  }

  @Post('devices/pairing-pin')
  pairingPin(
    @Merchant() t: MerchantAccess,
    @Body() body: Record<string, unknown>,
    @Query('locationId') locationId?: string,
  ) {
    return this.kds.createPairing(t.merchantId, locationId ?? null, body);
  }

  @Post('devices/pairing/:pairingId/approve')
  approvePairing(
    @Merchant() t: MerchantAccess,
    @CurrentUser() user: AuthUser,
    @Param('pairingId') pairingId: string,
  ) {
    return this.kds.approvePairing(t.merchantId, pairingId, user?.id ?? null);
  }

  @Post('devices/pairing/:pairingId/deny')
  denyPairing(@Merchant() t: MerchantAccess, @Param('pairingId') pairingId: string) {
    return this.kds.denyPairing(t.merchantId, pairingId);
  }

  @Patch('devices/:deviceId')
  updateDevice(
    @Merchant() t: MerchantAccess,
    @Param('deviceId') deviceId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.kds.updateDevice(t.merchantId, deviceId, body);
  }

  @Post('devices/:deviceId/revoke')
  revokeDevice(@Merchant() t: MerchantAccess, @Param('deviceId') deviceId: string) {
    return this.kds.revokeDevice(t.merchantId, deviceId);
  }

  @Post('orders/:ticketId/transition')
  transition(
    @Merchant() t: MerchantAccess,
    @CurrentUser() user: AuthUser,
    @Param('ticketId') ticketId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.kds.transitionFromDashboard(t.merchantId, user?.id ?? null, ticketId, body);
  }
}

/**
 * Legacy alias surface (`/api/:merchantRef/admin/devices`, `/orders`,
 * `/orders/:ticketId/transition`) so the dashboard's `/api/:merchantRef/admin/*`
 * device/order calls stop 404ing. Same service, same guard stack; reference→merchantId
 * is resolved by MerchantAccessGuard.
 */
@UseGuards(AuthGuard, MerchantAccessGuard, EntitlementGuard)
@RequireProduct('kds')
@Controller('api/:merchantRef/admin')
export class KdsAdminController {
  constructor(private readonly kds: KdsService) {}

  @Get('devices')
  listDevices(@Merchant() t: MerchantAccess, @Query('locationId') locationId?: string) {
    return this.kds.listDevicesForDashboard(t.merchantId, locationId ?? null);
  }

  @Get('orders')
  listOrders(
    @Merchant() t: MerchantAccess,
    @Query('filter') filter?: string,
    @Query('locationId') locationId?: string,
  ) {
    return this.kds.listOrdersForDashboard(t.merchantId, filter, locationId ?? null);
  }

  @Post('orders/:ticketId/transition')
  transition(
    @Merchant() t: MerchantAccess,
    @CurrentUser() user: AuthUser,
    @Param('ticketId') ticketId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.kds.transitionFromDashboard(t.merchantId, user?.id ?? null, ticketId, body);
  }
}

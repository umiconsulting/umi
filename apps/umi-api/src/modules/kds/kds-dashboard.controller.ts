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
import { RequirePermission } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CurrentUser, Merchant } from '../auth/current-user.decorator';
import type { AuthUser, MerchantAccess } from '../auth/auth.types';
import { KdsService } from './kds.service';
import { KdsLocationGuard } from './kds-location.guard';

/** The Dashboard uses this permission-controlled KDS surface. */
@UseGuards(AuthGuard, MerchantAccessGuard, EntitlementGuard, RolesGuard, KdsLocationGuard)
@RequireProduct('kds')
@RequirePermission('kitchen.read')
@Controller('api/merchants/:merchantId/kds')
export class KdsDashboardController {
  constructor(private readonly kds: KdsService) {}

  @Get('devices')
  @RequirePermission('kitchen.diagnostics')
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
  @RequirePermission('kitchen.station.read')
  listStations(@Merchant() t: MerchantAccess, @Query('locationId') locationId?: string) {
    return this.kds.listStationsForDashboard(t.merchantId, locationId ?? null);
  }

  @Post('stations')
  @RequirePermission('kitchen.station.manage')
  createStation(
    @Merchant() t: MerchantAccess,
    @Body() body: Record<string, unknown>,
    @Query('locationId') locationId?: string,
  ) {
    return this.kds.createStation(t.merchantId, locationId ?? null, body);
  }

  @Patch('stations/:stationId')
  @RequirePermission('kitchen.station.manage')
  updateStation(
    @Merchant() t: MerchantAccess,
    @Param('stationId') stationId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.kds.updateStation(t.merchantId, stationId, body);
  }

  @Delete('stations/:stationId')
  @RequirePermission('kitchen.station.manage')
  archiveStation(@Merchant() t: MerchantAccess, @Param('stationId') stationId: string) {
    return this.kds.archiveStation(t.merchantId, stationId);
  }

  @Get('routes')
  @RequirePermission('kitchen.station.read')
  listRoutes(@Merchant() t: MerchantAccess, @Query('locationId') locationId?: string) {
    return this.kds.listRoutes(t.merchantId, locationId ?? null);
  }

  @Post('routes')
  @RequirePermission('kitchen.station.manage')
  createRoute(
    @Merchant() t: MerchantAccess,
    @Query('locationId') locationId: string | undefined,
    @Body() body: Record<string, unknown>,
  ) {
    return this.kds.createRoute(t.merchantId, locationId ?? null, body);
  }

  @Patch('routes/:routeId')
  @RequirePermission('kitchen.station.manage')
  updateRoute(
    @Merchant() t: MerchantAccess,
    @Param('routeId') routeId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.kds.updateRoute(t.merchantId, routeId, body);
  }

  @Get('devices/pairing')
  @RequirePermission('kitchen.station.manage')
  listPairings(@Merchant() t: MerchantAccess, @Query('locationId') locationId?: string) {
    return this.kds.listPairingsForDashboard(t.merchantId, locationId ?? null);
  }

  // Both routes create one pairing PIN.
  @Post('devices/provision')
  @RequirePermission('kitchen.station.manage')
  provision(
    @Merchant() t: MerchantAccess,
    @Body() body: Record<string, unknown>,
    @Query('locationId') locationId?: string,
  ) {
    return this.kds.createPairing(t.merchantId, locationId ?? null, body);
  }

  @Post('devices/pairing-pin')
  @RequirePermission('kitchen.station.manage')
  pairingPin(
    @Merchant() t: MerchantAccess,
    @Body() body: Record<string, unknown>,
    @Query('locationId') locationId?: string,
  ) {
    return this.kds.createPairing(t.merchantId, locationId ?? null, body);
  }

  @Post('devices/pairing/:pairingId/approve')
  @RequirePermission('kitchen.station.manage')
  approvePairing(
    @Merchant() t: MerchantAccess,
    @CurrentUser() user: AuthUser,
    @Param('pairingId') pairingId: string,
  ) {
    return this.kds.approvePairing(t.merchantId, pairingId, user?.id ?? null);
  }

  @Post('devices/pairing/:pairingId/deny')
  @RequirePermission('kitchen.station.manage')
  denyPairing(@Merchant() t: MerchantAccess, @Param('pairingId') pairingId: string) {
    return this.kds.denyPairing(t.merchantId, pairingId);
  }

  @Patch('devices/:deviceId')
  @RequirePermission('kitchen.station.manage')
  updateDevice(
    @Merchant() t: MerchantAccess,
    @Param('deviceId') deviceId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.kds.updateDevice(t.merchantId, deviceId, body);
  }

  @Post('devices/:deviceId/revoke')
  @RequirePermission('kitchen.station.manage')
  revokeDevice(@Merchant() t: MerchantAccess, @Param('deviceId') deviceId: string) {
    return this.kds.revokeDevice(t.merchantId, deviceId);
  }

  @Post('orders/:ticketId/transition')
  @RequirePermission('kitchen.recall')
  transition(
    @Merchant() t: MerchantAccess,
    @CurrentUser() user: AuthUser,
    @Param('ticketId') ticketId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.kds.transitionFromDashboard(t.merchantId, user?.id ?? null, ticketId, body);
  }
}

/** These aliases keep the current Dashboard routes operational. */
@UseGuards(AuthGuard, MerchantAccessGuard, EntitlementGuard, RolesGuard, KdsLocationGuard)
@RequireProduct('kds')
@RequirePermission('kitchen.read')
@Controller('api/:merchantRef/admin')
export class KdsAdminController {
  constructor(private readonly kds: KdsService) {}

  @Get('devices')
  @RequirePermission('kitchen.diagnostics')
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
  @RequirePermission('kitchen.recall')
  transition(
    @Merchant() t: MerchantAccess,
    @CurrentUser() user: AuthUser,
    @Param('ticketId') ticketId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.kds.transitionFromDashboard(t.merchantId, user?.id ?? null, ticketId, body);
  }
}

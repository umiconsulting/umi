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
import { TenantAccessGuard } from '../auth/tenant-access.guard';
import { EntitlementGuard } from '../auth/entitlement.guard';
import { RequireProduct } from '../auth/require-product.decorator';
import { CurrentUser, Tenant } from '../auth/current-user.decorator';
import type { AuthUser, TenantAccess } from '../auth/auth.types';
import { KdsService } from './kds.service';

/**
 * Owner-facing KDS surface the dashboard SPA calls
 * (`/api/tenants/:tenantId/kds/*`). Cookie-authed + membership-checked +
 * `kds`-entitlement gated by the shared guard stack (same trust model as the
 * cash admin routes — no extra per-action permission). This replaces the legacy
 * `server.js` `callKdsPairingBackend` proxy: it dispatches to the in-process
 * `KdsService` directly. All routes honor `?locationId=`.
 */
@UseGuards(AuthGuard, TenantAccessGuard, EntitlementGuard)
@RequireProduct('kds')
@Controller('api/tenants/:tenantId/kds')
export class KdsDashboardController {
  constructor(private readonly kds: KdsService) {}

  @Get('devices')
  listDevices(@Tenant() t: TenantAccess, @Query('locationId') locationId?: string) {
    return this.kds.listDevicesForDashboard(t.tenantId, locationId ?? null);
  }

  @Get('orders')
  listOrders(
    @Tenant() t: TenantAccess,
    @Query('filter') filter?: string,
    @Query('locationId') locationId?: string,
  ) {
    return this.kds.listOrdersForDashboard(t.tenantId, filter, locationId ?? null);
  }

  @Get('ticker')
  ticker(@Tenant() t: TenantAccess) {
    return this.kds.tickerForDashboard(t.tenantId);
  }

  @Get('stations')
  listStations(@Tenant() t: TenantAccess, @Query('locationId') locationId?: string) {
    return this.kds.listStationsForDashboard(t.tenantId, locationId ?? null);
  }

  @Post('stations')
  createStation(
    @Tenant() t: TenantAccess,
    @Body() body: Record<string, unknown>,
    @Query('locationId') locationId?: string,
  ) {
    return this.kds.createStation(t.tenantId, locationId ?? null, body);
  }

  @Patch('stations/:stationId')
  updateStation(
    @Tenant() t: TenantAccess,
    @Param('stationId') stationId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.kds.updateStation(t.tenantId, stationId, body);
  }

  @Delete('stations/:stationId')
  archiveStation(@Tenant() t: TenantAccess, @Param('stationId') stationId: string) {
    return this.kds.archiveStation(t.tenantId, stationId);
  }

  @Get('devices/pairing')
  listPairings(@Tenant() t: TenantAccess, @Query('locationId') locationId?: string) {
    return this.kds.listPairingsForDashboard(t.tenantId, locationId ?? null);
  }

  // provision + pairing-pin both create a pairing PIN (the SPA's "add device").
  @Post('devices/provision')
  provision(
    @Tenant() t: TenantAccess,
    @Body() body: Record<string, unknown>,
    @Query('locationId') locationId?: string,
  ) {
    return this.kds.createPairing(t.tenantId, locationId ?? null, body);
  }

  @Post('devices/pairing-pin')
  pairingPin(
    @Tenant() t: TenantAccess,
    @Body() body: Record<string, unknown>,
    @Query('locationId') locationId?: string,
  ) {
    return this.kds.createPairing(t.tenantId, locationId ?? null, body);
  }

  @Post('devices/pairing/:pairingId/approve')
  approvePairing(
    @Tenant() t: TenantAccess,
    @CurrentUser() user: AuthUser,
    @Param('pairingId') pairingId: string,
  ) {
    return this.kds.approvePairing(t.tenantId, pairingId, user?.id ?? null);
  }

  @Post('devices/pairing/:pairingId/deny')
  denyPairing(@Tenant() t: TenantAccess, @Param('pairingId') pairingId: string) {
    return this.kds.denyPairing(t.tenantId, pairingId);
  }

  @Patch('devices/:deviceId')
  updateDevice(
    @Tenant() t: TenantAccess,
    @Param('deviceId') deviceId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.kds.updateDevice(t.tenantId, deviceId, body);
  }

  @Post('devices/:deviceId/revoke')
  revokeDevice(@Tenant() t: TenantAccess, @Param('deviceId') deviceId: string) {
    return this.kds.revokeDevice(t.tenantId, deviceId);
  }

  @Post('orders/:ticketId/transition')
  transition(
    @Tenant() t: TenantAccess,
    @CurrentUser() user: AuthUser,
    @Param('ticketId') ticketId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.kds.transitionFromDashboard(t.tenantId, user?.id ?? null, ticketId, body);
  }
}

/**
 * Legacy slug alias surface (`/api/:slug/admin/devices`, `/orders`,
 * `/orders/:ticketId/transition`) so the dashboard's `/api/:slug/admin/*`
 * device/order calls stop 404ing. Same service, same guard stack; slug→tenantId
 * is resolved by TenantAccessGuard.
 */
@UseGuards(AuthGuard, TenantAccessGuard, EntitlementGuard)
@RequireProduct('kds')
@Controller('api/:slug/admin')
export class KdsAdminController {
  constructor(private readonly kds: KdsService) {}

  @Get('devices')
  listDevices(@Tenant() t: TenantAccess, @Query('locationId') locationId?: string) {
    return this.kds.listDevicesForDashboard(t.tenantId, locationId ?? null);
  }

  @Get('orders')
  listOrders(
    @Tenant() t: TenantAccess,
    @Query('filter') filter?: string,
    @Query('locationId') locationId?: string,
  ) {
    return this.kds.listOrdersForDashboard(t.tenantId, filter, locationId ?? null);
  }

  @Post('orders/:ticketId/transition')
  transition(
    @Tenant() t: TenantAccess,
    @CurrentUser() user: AuthUser,
    @Param('ticketId') ticketId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.kds.transitionFromDashboard(t.tenantId, user?.id ?? null, ticketId, body);
  }
}

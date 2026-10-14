import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { MerchantAccessGuard } from '../auth/merchant-access.guard';
import { EntitlementGuard } from '../auth/entitlement.guard';
import { RequireProduct } from '../auth/require-product.decorator';
import { RequirePermission } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { Merchant } from '../auth/current-user.decorator';
import type { MerchantAccess } from '../auth/auth.types';
import { locationScopeFor } from '../auth/location-authority';
import { PosHardwareService } from './pos-hardware.service';

/**
 * The back office's hardware inventory.
 *
 * WHY IT EXISTS. A café's printers are inventory: somebody has to be able to say how many
 * the business owns, which model they are, how each one connects and which register it
 * serves — without standing at a till. Until this route the only reader of
 * `merchant.hardware_device` was the till's own snapshot, so the printers existed for the
 * POS and for nobody else.
 *
 * IT READS, IT DOES NOT DRIVE. Registering, assigning, enabling and every command stay on
 * the till's surface (`PosHardwareController`), where an operator session proves who is
 * standing at the hardware. This route carries the session of a person in the back office
 * and answers only "what is there".
 */
@UseGuards(AuthGuard, MerchantAccessGuard, EntitlementGuard, RolesGuard)
@RequireProduct('pos')
// `device.enroll`, not `hardware.read`: this list is drawn by the Devices screen, whose
// client gate is `device.enroll`. A handler stricter than the screen that shows it would
// refuse a route the client has already drawn.
@RequirePermission('device.enroll')
@Controller('api/v1/merchants/:merchantId/hardware')
export class PosHardwareDashboardController {
  constructor(private readonly hardware: PosHardwareService) {}

  @Get()
  list(@Merchant() merchant: MerchantAccess, @Query('locationId') locationId?: string) {
    return this.hardware.listForDashboard(
      merchant.merchantId,
      locationScopeFor(merchant, locationId),
    );
  }
}

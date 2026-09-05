import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  AcknowledgeDeviceCredentialRequest,
  BeginDeviceEnrollmentRequest,
  ClaimDevicePairingRequest,
  DecideDeviceEnrollmentRequest,
  PollDevicePairingRequest,
  RevokeDeviceRequest,
  ReplaceDeviceRequest,
  RotateDeviceCredentialRequest,
  UpdateDeviceRequest,
} from '@umi/contract';
import type { FastifyRequest } from 'fastify';
import { ZodValidationPipe } from '../../shared/http/zod-validation.pipe';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser, Merchant } from '../auth/current-user.decorator';
import { Public } from '../auth/public.decorator';
import { RequirePermission } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { MerchantAccessGuard } from '../auth/merchant-access.guard';
import { EntitlementGuard } from '../auth/entitlement.guard';
import { RequireProduct } from '../auth/require-product.decorator';
import type { AuthUser, MerchantAccess } from '../auth/auth.types';
import { canSwitchLocations, resolveLocationAuthority } from '../auth/location-authority';
import { DevicesService } from './devices.service';

@UseGuards(AuthGuard)
@Controller('api/v1')
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  @Post('merchants/:merchantId/devices/enrollment')
  @UseGuards(MerchantAccessGuard, EntitlementGuard, RolesGuard)
  @RequireProduct('pos')
  @RequirePermission('device.enroll')
  begin(
    @Merchant() merchant: MerchantAccess,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(BeginDeviceEnrollmentRequest)) dto: BeginDeviceEnrollmentRequest,
  ) {
    const locationId = resolveLocationAuthority(merchant, dto.locationId);
    if (!locationId) throw new BadRequestException({ error: 'location_required' });
    return this.devices.begin(merchant.merchantId, user.id, { ...dto, locationId });
  }

  @Public()
  @Post('devices/pairing/claim')
  claim(
    @Req() request: FastifyRequest,
    @Body(new ZodValidationPipe(ClaimDevicePairingRequest))
    dto: ClaimDevicePairingRequest,
  ) {
    return this.devices.claim(dto, request.ip);
  }

  /**
   * The enrolled POS terminals. It is a separate route from the KDS device list on
   * purpose: a KDS iPad is read through its live session, a POS terminal through its
   * registry row, and one query cannot answer both without lying about one of them.
   */
  @Get('merchants/:merchantId/devices')
  @UseGuards(MerchantAccessGuard, EntitlementGuard, RolesGuard)
  @RequireProduct('pos')
  @RequirePermission('device.enroll')
  listDevices(@Merchant() merchant: MerchantAccess, @Query('locationId') locationId?: string) {
    return this.devices.listDevices(merchant.merchantId, deviceLocationScope(merchant, locationId));
  }

  @Patch('merchants/:merchantId/devices/:deviceId')
  @UseGuards(MerchantAccessGuard, EntitlementGuard, RolesGuard)
  @RequireProduct('pos')
  @RequirePermission('device.enroll')
  update(
    @Merchant() merchant: MerchantAccess,
    @Param('deviceId') deviceId: string,
    @Query('locationId') locationId: string | undefined,
    @Body(new ZodValidationPipe(UpdateDeviceRequest)) dto: UpdateDeviceRequest,
  ) {
    return this.devices.update(
      merchant.merchantId,
      deviceId,
      dto,
      deviceLocationScope(merchant, locationId),
    );
  }

  @Get('merchants/:merchantId/devices/enrollment-requests')
  @UseGuards(MerchantAccessGuard, EntitlementGuard, RolesGuard)
  @RequireProduct('pos')
  @RequirePermission('device.enroll')
  list(@Merchant() merchant: MerchantAccess, @Query('locationId') locationId?: string) {
    return this.devices.list(merchant.merchantId, deviceLocationScope(merchant, locationId));
  }

  @Post('merchants/:merchantId/devices/enrollment-requests/:requestId/approve')
  @UseGuards(MerchantAccessGuard, EntitlementGuard, RolesGuard)
  @RequireProduct('pos')
  @RequirePermission('device.enroll')
  approve(
    @Merchant() merchant: MerchantAccess,
    @CurrentUser() user: AuthUser,
    @Param('requestId') requestId: string,
    @Query('locationId') locationId: string | undefined,
    @Body(new ZodValidationPipe(DecideDeviceEnrollmentRequest))
    dto: DecideDeviceEnrollmentRequest,
  ) {
    return this.devices.approve(
      merchant.merchantId,
      user.id,
      requestId,
      dto.idempotencyKey,
      deviceLocationScope(merchant, locationId),
    );
  }

  @Post('merchants/:merchantId/devices/enrollment-requests/:requestId/deny')
  @UseGuards(MerchantAccessGuard, EntitlementGuard, RolesGuard)
  @RequireProduct('pos')
  @RequirePermission('device.enroll')
  deny(
    @Merchant() merchant: MerchantAccess,
    @CurrentUser() user: AuthUser,
    @Param('requestId') requestId: string,
    @Query('locationId') locationId: string | undefined,
    @Body(new ZodValidationPipe(DecideDeviceEnrollmentRequest))
    dto: DecideDeviceEnrollmentRequest,
  ) {
    return this.devices.deny(
      merchant.merchantId,
      user.id,
      requestId,
      dto.idempotencyKey,
      deviceLocationScope(merchant, locationId),
    );
  }

  @Public()
  @Post('devices/pairing/:pairingSessionId/poll')
  poll(
    @Req() request: FastifyRequest,
    @Param('pairingSessionId') pairingSessionId: string,
    @Body(new ZodValidationPipe(PollDevicePairingRequest))
    dto: PollDevicePairingRequest,
  ) {
    return this.devices.poll(pairingSessionId, dto, request.ip);
  }

  @Public()
  @Post('devices/pairing/:pairingSessionId/acknowledge')
  acknowledge(
    @Req() request: FastifyRequest,
    @Param('pairingSessionId') pairingSessionId: string,
    @Body(new ZodValidationPipe(AcknowledgeDeviceCredentialRequest))
    dto: AcknowledgeDeviceCredentialRequest,
  ) {
    return this.devices.acknowledge(pairingSessionId, dto, request.ip);
  }

  @Public()
  @Get('devices/status')
  status(
    @Headers('x-umi-device-public-id') publicId: string | undefined,
    @Headers('x-umi-installation-id') installationId: string | undefined,
    @Headers('x-umi-device-credential') credential: string | undefined,
  ) {
    return this.devices.authenticate(publicId, installationId, credential, true);
  }

  @Post('merchants/:merchantId/devices/:deviceId/rotate')
  @UseGuards(MerchantAccessGuard, EntitlementGuard, RolesGuard)
  @RequireProduct('pos')
  @RequirePermission('device.enroll')
  rotate(
    @Merchant() merchant: MerchantAccess,
    @Param('deviceId') deviceId: string,
    @Body(new ZodValidationPipe(RotateDeviceCredentialRequest))
    dto: RotateDeviceCredentialRequest,
  ) {
    return this.devices.rotate(
      merchant.merchantId,
      deviceId,
      dto.currentCredentialVersion,
      dto.idempotencyKey,
    );
  }

  @Post('merchants/:merchantId/devices/:deviceId/revoke')
  @UseGuards(MerchantAccessGuard, EntitlementGuard, RolesGuard)
  @RequireProduct('pos')
  @RequirePermission('device.enroll')
  async revoke(
    @Merchant() merchant: MerchantAccess,
    @Param('deviceId') deviceId: string,
    @Body(new ZodValidationPipe(RevokeDeviceRequest)) dto: RevokeDeviceRequest,
  ) {
    await this.devices.revoke(merchant.merchantId, deviceId, dto.reason, dto.idempotencyKey);
    return { ok: true as const };
  }

  @Post('merchants/:merchantId/devices/replacement')
  @UseGuards(MerchantAccessGuard, EntitlementGuard, RolesGuard)
  @RequireProduct('pos')
  @RequirePermission('device.enroll')
  replace(
    @Merchant() merchant: MerchantAccess,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(ReplaceDeviceRequest)) dto: ReplaceDeviceRequest,
  ) {
    return this.devices.beginForReplacement(
      merchant.merchantId,
      user.id,
      dto,
      dto.replacedDeviceId,
    );
  }
}

export function deviceLocationScope(
  merchant: MerchantAccess,
  requestedLocationId?: string,
): string[] | null {
  const locationId = resolveLocationAuthority(merchant, requestedLocationId);
  if (locationId) return [locationId];
  return canSwitchLocations(merchant) ? null : [];
}

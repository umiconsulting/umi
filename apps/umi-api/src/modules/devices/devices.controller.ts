import { Body, Controller, Get, Headers, Param, Post, Req, UseGuards } from '@nestjs/common';
import {
  AcknowledgeDeviceCredentialRequest,
  BeginDeviceEnrollmentRequest,
  ClaimDevicePairingRequest,
  DecideDeviceEnrollmentRequest,
  PollDevicePairingRequest,
  RevokeDeviceRequest,
  ReplaceDeviceRequest,
  RotateDeviceCredentialRequest,
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
    return this.devices.begin(merchant.merchantId, user.id, dto);
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

  @Get('merchants/:merchantId/devices/enrollment-requests')
  @UseGuards(MerchantAccessGuard, EntitlementGuard, RolesGuard)
  @RequireProduct('pos')
  @RequirePermission('device.enroll')
  list(@Merchant() merchant: MerchantAccess) {
    return this.devices.list(merchant.merchantId, null);
  }

  @Post('merchants/:merchantId/devices/enrollment-requests/:requestId/approve')
  @UseGuards(MerchantAccessGuard, EntitlementGuard, RolesGuard)
  @RequireProduct('pos')
  @RequirePermission('device.enroll')
  approve(
    @Merchant() merchant: MerchantAccess,
    @CurrentUser() user: AuthUser,
    @Param('requestId') requestId: string,
    @Body(new ZodValidationPipe(DecideDeviceEnrollmentRequest))
    dto: DecideDeviceEnrollmentRequest,
  ) {
    return this.devices.approve(merchant.merchantId, user.id, requestId, dto.idempotencyKey, null);
  }

  @Post('merchants/:merchantId/devices/enrollment-requests/:requestId/deny')
  @UseGuards(MerchantAccessGuard, EntitlementGuard, RolesGuard)
  @RequireProduct('pos')
  @RequirePermission('device.enroll')
  deny(
    @Merchant() merchant: MerchantAccess,
    @CurrentUser() user: AuthUser,
    @Param('requestId') requestId: string,
    @Body(new ZodValidationPipe(DecideDeviceEnrollmentRequest))
    dto: DecideDeviceEnrollmentRequest,
  ) {
    return this.devices.deny(merchant.merchantId, user.id, requestId, dto.idempotencyKey, null);
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

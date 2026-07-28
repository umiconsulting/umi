import { Body, Controller, Get, Headers, Param, Post, UseGuards } from '@nestjs/common';
import {
  BeginDeviceEnrollmentRequest,
  CompleteDeviceEnrollmentRequest,
  RevokeDeviceRequest,
  ReplaceDeviceRequest,
  RotateDeviceCredentialRequest,
} from '@umi/contract';
import { ZodValidationPipe } from '../../shared/http/zod-validation.pipe';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser, Tenant } from '../auth/current-user.decorator';
import { Public } from '../auth/public.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { TenantAccessGuard } from '../auth/tenant-access.guard';
import type { AuthUser, TenantAccess } from '../auth/auth.types';
import { DevicesService } from './devices.service';

@UseGuards(AuthGuard)
@Controller('api')
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  @Post('tenants/:tenantId/devices/enrollment')
  @UseGuards(TenantAccessGuard, RolesGuard)
  @Roles('owner', 'admin', 'super_admin')
  begin(
    @Tenant() tenant: TenantAccess,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(BeginDeviceEnrollmentRequest)) dto: BeginDeviceEnrollmentRequest,
  ) {
    return this.devices.begin(tenant.tenantId, user.id, dto);
  }

  @Public()
  @Post('devices/enrollment/complete')
  complete(
    @Body(new ZodValidationPipe(CompleteDeviceEnrollmentRequest))
    dto: CompleteDeviceEnrollmentRequest,
  ) {
    return this.devices.complete(dto);
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

  @Post('tenants/:tenantId/devices/:deviceId/rotate')
  @UseGuards(TenantAccessGuard, RolesGuard)
  @Roles('owner', 'admin', 'super_admin')
  rotate(
    @Tenant() tenant: TenantAccess,
    @Param('deviceId') deviceId: string,
    @Body(new ZodValidationPipe(RotateDeviceCredentialRequest))
    dto: RotateDeviceCredentialRequest,
  ) {
    return this.devices.rotate(
      tenant.tenantId,
      deviceId,
      dto.currentCredentialVersion,
      dto.idempotencyKey,
    );
  }

  @Post('tenants/:tenantId/devices/:deviceId/revoke')
  @UseGuards(TenantAccessGuard, RolesGuard)
  @Roles('owner', 'admin', 'super_admin')
  async revoke(
    @Tenant() tenant: TenantAccess,
    @Param('deviceId') deviceId: string,
    @Body(new ZodValidationPipe(RevokeDeviceRequest)) dto: RevokeDeviceRequest,
  ) {
    await this.devices.revoke(tenant.tenantId, deviceId, dto.reason, dto.idempotencyKey);
    return { ok: true as const };
  }

  @Post('tenants/:tenantId/devices/replacement')
  @UseGuards(TenantAccessGuard, RolesGuard)
  @Roles('owner', 'admin', 'super_admin')
  replace(
    @Tenant() tenant: TenantAccess,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(ReplaceDeviceRequest)) dto: ReplaceDeviceRequest,
  ) {
    return this.devices.beginForReplacement(tenant.tenantId, user.id, dto, dto.replacedDeviceId);
  }
}

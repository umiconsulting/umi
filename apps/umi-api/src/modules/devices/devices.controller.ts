import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Param,
  Post,
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
} from '@umi/contract';
import type { FastifyRequest } from 'fastify';
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
    this.assertBranchAccess(tenant, dto.branchId);
    return this.devices.begin(tenant.tenantId, user.id, dto);
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

  @Get('tenants/:tenantId/devices/enrollment-requests')
  @UseGuards(TenantAccessGuard, RolesGuard)
  @Roles('owner', 'admin', 'super_admin')
  list(@Tenant() tenant: TenantAccess) {
    return this.devices.list(tenant.tenantId, tenant.allBranches ? null : tenant.branchIds);
  }

  @Post('tenants/:tenantId/devices/enrollment-requests/:requestId/approve')
  @UseGuards(TenantAccessGuard, RolesGuard)
  @Roles('owner', 'admin', 'super_admin')
  approve(
    @Tenant() tenant: TenantAccess,
    @CurrentUser() user: AuthUser,
    @Param('requestId') requestId: string,
    @Body(new ZodValidationPipe(DecideDeviceEnrollmentRequest))
    dto: DecideDeviceEnrollmentRequest,
  ) {
    return this.devices.approve(
      tenant.tenantId,
      user.id,
      requestId,
      dto.idempotencyKey,
      tenant.allBranches ? null : tenant.branchIds,
    );
  }

  @Post('tenants/:tenantId/devices/enrollment-requests/:requestId/deny')
  @UseGuards(TenantAccessGuard, RolesGuard)
  @Roles('owner', 'admin', 'super_admin')
  deny(
    @Tenant() tenant: TenantAccess,
    @CurrentUser() user: AuthUser,
    @Param('requestId') requestId: string,
    @Body(new ZodValidationPipe(DecideDeviceEnrollmentRequest))
    dto: DecideDeviceEnrollmentRequest,
  ) {
    return this.devices.deny(
      tenant.tenantId,
      user.id,
      requestId,
      dto.idempotencyKey,
      tenant.allBranches ? null : tenant.branchIds,
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
    this.assertBranchAccess(tenant, dto.branchId);
    return this.devices.beginForReplacement(tenant.tenantId, user.id, dto, dto.replacedDeviceId);
  }

  private assertBranchAccess(tenant: TenantAccess, branchId: string | null): void {
    if (!tenant.allBranches && (branchId === null || !tenant.branchIds.includes(branchId))) {
      throw new ForbiddenException({ code: 'PERMISSION_DENIED' });
    }
  }
}

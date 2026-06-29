import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { TenantAccessGuard } from '../auth/tenant-access.guard';
import { Tenant } from '../auth/current-user.decorator';
import type { TenantAccess } from '../auth/auth.types';
import { VoiceService } from './voice.service';
import { UpdateVoiceDto } from './dto/update-voice.dto';

/**
 * Tenant-routed voice & tone settings the dashboard SPA calls
 * (`/api/tenants/:tenantId/conversaflow/voice`). Sibling of HoursTenantController.
 * Voice is tenant-level (one business per tenant) → no `locationId`. The
 * `:tenantId` is resolved + membership-checked by the same guard stack; reads and
 * writes both run on the RLS app pool (authenticated staff with a member user).
 */
@UseGuards(AuthGuard, TenantAccessGuard)
@Controller('api/tenants/:tenantId/conversaflow/voice')
export class VoiceController {
  constructor(private readonly voice: VoiceService) {}

  @Get()
  get(@Tenant() tenant: TenantAccess) {
    return this.voice.getVoiceSettings(tenant.tenantId);
  }

  @Patch()
  async update(@Tenant() tenant: TenantAccess, @Body() dto: UpdateVoiceDto) {
    await this.voice.updateVoice(tenant.tenantId, dto);
    return { ok: true };
  }
}

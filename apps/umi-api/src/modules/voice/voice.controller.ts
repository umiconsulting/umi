import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { MerchantAccessGuard } from '../auth/merchant-access.guard';
import { Merchant } from '../auth/current-user.decorator';
import type { MerchantAccess } from '../auth/auth.types';
import { VoiceService } from './voice.service';
import { UpdateVoiceDto } from './dto/update-voice.dto';

/**
 * Merchant-routed voice & tone settings the dashboard SPA calls
 * (`/api/merchants/:merchantId/conversaflow/voice`). Sibling of HoursMerchantController.
 * Voice is merchant-level (one merchant per merchant) → no `locationId`. The
 * `:merchantId` is resolved + membership-checked by the same guard stack; reads and
 * writes both run on the RLS app pool (authenticated staff with a member user).
 */
@UseGuards(AuthGuard, MerchantAccessGuard)
@Controller('api/merchants/:merchantId/conversaflow/voice')
export class VoiceController {
  constructor(private readonly voice: VoiceService) {}

  @Get()
  get(@Merchant() merchant: MerchantAccess) {
    return this.voice.getVoiceSettings(merchant.merchantId);
  }

  @Patch()
  async update(@Merchant() merchant: MerchantAccess, @Body() dto: UpdateVoiceDto) {
    await this.voice.updateVoice(merchant.merchantId, dto);
    return { ok: true };
  }
}

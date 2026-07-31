import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { VoiceController } from './voice.controller';
import { VoiceService } from './voice.service';
import { VoiceSettingsRepository } from './voice-settings.repository';

/**
 * Voice & tone settings — the dashboard-facing read/write over
 * `merchant.merchant.config.voice` (the same jsonb the WhatsApp bot resolves via
 * MerchantConfigService/resolveVoiceConfig). Imports AuthModule (guards); no
 * MerchantsModule needed (voice is merchant-level — no location resolution). PgService
 * is @Global, so VoiceSettingsRepository injects it with no extra import.
 */
@Module({
  imports: [AuthModule],
  controllers: [VoiceController],
  providers: [VoiceService, VoiceSettingsRepository],
})
export class VoiceModule {}

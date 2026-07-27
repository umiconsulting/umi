import { Injectable } from '@nestjs/common';
import {
  DEFAULT_TONE_PRESET,
  TONE_PRESETS,
  TONE_PRESET_KEYS,
  type TonePreset,
} from '../conversations/business-config.service';
import { VoiceSettingsRepository } from './voice-settings.repository';
import { UpdateVoiceDto } from './dto/update-voice.dto';

/**
 * Voice & tone settings — the dashboard-facing read/write over the SAME typed
 * columns the WhatsApp bot resolves (`tenant.business.assistant_name` /
 * `assistant_tone`). Two knobs only: the tone-preset chip and an optional assistant
 * name. TONE_PRESETS is the one shared catalog (no duplication); the engine reads
 * them via resolveVoiceConfig.
 */
@Injectable()
export class VoiceService {
  constructor(private readonly repo: VoiceSettingsRepository) {}

  /** Dashboard GET — current stored voice + resolved chip default + preset catalog. */
  async getVoiceSettings(tenantId: string) {
    const { businessName, voice } = await this.repo.read(tenantId);
    const v = voice ?? {};
    const presetKey =
      typeof v.tone_preset === 'string' && TONE_PRESETS[v.tone_preset as TonePreset]
        ? (v.tone_preset as TonePreset)
        : DEFAULT_TONE_PRESET;
    return {
      voice: {
        assistant_name:
          typeof v.assistant_name === 'string' && v.assistant_name.trim()
            ? v.assistant_name.trim()
            : null,
        tone_preset: presetKey,
      },
      businessName, // assistant_name placeholder in the UI
      defaults: {
        assistant_name: businessName,
        tone_preset: DEFAULT_TONE_PRESET,
      },
      presets: TONE_PRESET_KEYS.map((k) => ({
        key: k,
        label: TONE_PRESETS[k].label,
        description: TONE_PRESETS[k].tone,
      })),
    };
  }

  /** Dashboard PATCH — persist only the provided knobs. Trimmed-empty → null so a
   *  cleared name reverts to the business-name default. */
  async updateVoice(tenantId: string, dto: UpdateVoiceDto): Promise<void> {
    const patch: { assistant_name?: string | null; tone_preset?: string | null } = {};
    if (dto.assistant_name !== undefined) {
      patch.assistant_name = dto.assistant_name.trim() || null;
    }
    if (dto.tone_preset !== undefined) patch.tone_preset = dto.tone_preset;
    if (Object.keys(patch).length === 0) return;
    await this.repo.write(tenantId, patch);
  }
}

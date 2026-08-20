import { Injectable } from '@nestjs/common';
import {
  DEFAULT_LOCALE,
  DEFAULT_TONE_PRESET,
  TONE_PRESETS,
  TONE_PRESET_KEYS,
  type TonePreset,
} from '../conversations/business-config.service';
import { VoiceSettingsRepository } from './voice-settings.repository';
import { UpdateVoiceDto } from './dto/update-voice.dto';

/**
 * Voice & tone settings — the dashboard-facing read/write over the SAME jsonb the
 * WhatsApp bot resolves (`tenant.business.config.voice`). Sibling of HoursService:
 * the dashboard chips (tone_preset) + advanced overrides (assistant name / freeform
 * tone / style notes) are persisted here; the engine reads them via
 * resolveVoiceConfig. TONE_PRESETS is the one shared catalog (no duplication).
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
        locale:
          typeof v.locale === 'string' && v.locale.trim()
            ? v.locale.trim()
            : DEFAULT_LOCALE,
        tone_preset: presetKey,
        tone: typeof v.tone === 'string' && v.tone.trim() ? v.tone.trim() : null,
        style_notes: Array.isArray(v.style_notes)
          ? v.style_notes
              .filter((s) => typeof s === 'string')
              .map((s) => s.trim())
              .filter(Boolean)
          : [],
      },
      businessName, // assistant_name placeholder in the UI
      defaults: {
        assistant_name: businessName,
        locale: DEFAULT_LOCALE,
        tone_preset: DEFAULT_TONE_PRESET,
      },
      presets: TONE_PRESET_KEYS.map((k) => ({
        key: k,
        label: TONE_PRESETS[k].label,
        description: TONE_PRESETS[k].tone,
      })),
    };
  }

  /** Dashboard PATCH — persist only the provided fields. Trimmed-empty → null so a
   *  cleared freeform tone or name reverts to preset / business-name default. */
  async updateVoice(tenantId: string, dto: UpdateVoiceDto): Promise<void> {
    const patch: Record<string, unknown> = {};
    if (dto.assistant_name !== undefined) {
      patch.assistant_name = dto.assistant_name.trim() || null;
    }
    if (dto.locale !== undefined) patch.locale = dto.locale.trim() || null;
    if (dto.tone_preset !== undefined) patch.tone_preset = dto.tone_preset;
    if (dto.tone !== undefined) {
      patch.tone = dto.tone.trim() || null; // '' clears the override → preset wins
    }
    if (dto.style_notes !== undefined) {
      patch.style_notes = dto.style_notes.map((s) => s.trim()).filter(Boolean);
    }
    if (Object.keys(patch).length === 0) return;
    await this.repo.write(tenantId, patch);
  }
}

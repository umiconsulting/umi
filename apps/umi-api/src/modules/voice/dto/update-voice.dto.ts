import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { TONE_PRESET_KEYS, type TonePreset } from '../../conversations/merchant-config.service';

/**
 * Voice PATCH body — flat + every field optional (matches UpdateHoursDto idiom,
 * supports partial saves). NOTE: forbidNonWhitelisted is OFF globally
 * (main.ts:29) so undecorated keys are silently stripped — every persisted field
 * MUST be decorated here. Two knobs only: the assistant name and the tone preset.
 */
export class UpdateVoiceDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  assistant_name?: string;

  @IsOptional()
  @IsIn(TONE_PRESET_KEYS)
  tone_preset?: TonePreset;
}

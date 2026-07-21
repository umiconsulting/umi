import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { TONE_PRESET_KEYS, type TonePreset } from '../../conversations/business-config.service';

/**
 * Voice PATCH body — flat + every field optional (matches UpdateHoursDto idiom,
 * supports partial saves). NOTE: forbidNonWhitelisted is OFF globally
 * (main.ts:29) so undecorated keys are silently stripped — every persisted field
 * MUST be decorated here. An empty-string `tone` is a valid string and is the
 * signal to CLEAR a freeform override (the preset wins again).
 */
export class UpdateVoiceDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  assistant_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  locale?: string;

  @IsOptional()
  @IsIn(TONE_PRESET_KEYS)
  tone_preset?: TonePreset;

  @IsOptional()
  @IsString()
  @MaxLength(280)
  tone?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  style_notes?: string[];
}

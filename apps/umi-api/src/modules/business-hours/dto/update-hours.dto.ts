import { IsObject, IsOptional, IsString } from 'class-validator';
import type { OrderingPatch } from '../ordering-settings.repository';

/**
 * Hours PATCH body. All three blocks are optional so a partial save (e.g. just
 * the weekly grid, or just the pause toggle) works. Shapes are validated
 * structurally in the service/repository (server.js-identical), so typed loosely.
 */
export class UpdateHoursDto {
  // Map of day-id → { open, from, to }.
  @IsOptional()
  @IsObject()
  hours?: Record<string, { open: boolean; from: string; to: string }>;

  // IANA timezone → merchant.merchant.timezone.
  @IsOptional()
  @IsString()
  timezone?: string;

  // Ordering-window settings → the typed merchant.merchant.whatsapp_* columns
  // (ordering_enabled / order_cutoff_minutes / ordering_notice / bypass_phone).
  @IsOptional()
  @IsObject()
  ordering?: OrderingPatch;
}

import { IsObject } from 'class-validator';

export class UpdateHoursDto {
  // Map of day-id → { open, from, to }. Validated structurally in the service
  // (server.js-identical), so typed loosely here.
  @IsObject()
  hours!: Record<string, { open: boolean; from: string; to: string }>;
}

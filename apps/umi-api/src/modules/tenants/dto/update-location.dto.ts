import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class UpdateLocationDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  timezone?: string;

  @IsOptional()
  @IsIn(['active', 'inactive', 'archived'])
  status?: string;

  // Branch resolution (Phase 2): owner-curated nicknames the bot matches a
  // customer's branch mention against (e.g. ["chapu"] for "Chapultepec"). The
  // bot reads these as the sole gate (no re-validation downstream), so bound
  // here for length, non-emptiness, and case-insensitive uniqueness — a direct
  // API caller can't slip past the dashboard's client-side trim/dedupe.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(24)
  @ArrayUnique((a: string) => a.toLowerCase())
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(40, { each: true })
  aliases?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(160)
  descriptor?: string;
}

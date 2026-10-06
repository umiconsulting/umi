import {
  ArrayMaxSize,
  IsLatitude,
  IsLongitude,
  ArrayUnique,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/** The two values `merchant.location.status`'s CHECK admits. */
export const LOCATION_STATUSES = ['active', 'closed'] as const;
export type LocationStatus = (typeof LOCATION_STATUSES)[number];

export class UpdateLocationDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  timezone?: string;

  // ('active','closed') — the CHECK on `merchant.location.status`, and nothing
  // wider. This list used to read ('active','inactive','archived'), which was the
  // legacy vocabulary: closing a branch answered 400 because 'closed' was not on
  // the list, and the two names that were on it reached the database and came back
  // 23514, which the operator saw as a 500. A DTO that disagrees with a CHECK is
  // not a loose validator — it is a control that cannot be operated.
  @IsOptional()
  @IsIn(LOCATION_STATUSES)
  status?: LocationStatus;

  // Location resolution (Phase 2): owner-curated nicknames the bot matches a
  // customer's location mention against (e.g. ["chapu"] for "Chapultepec"). The
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

  // The physical place. All three are CLEARABLE: `null` means "stop recording
  // this", which is not the same as omitting the field. See `updateLocation` in the
  // repository — omitted leaves the column alone, null writes null.
  @IsOptional()
  @IsString()
  @MaxLength(200)
  address?: string | null;

  @IsOptional()
  @IsLatitude()
  latitude?: number | null;

  @IsOptional()
  @IsLongitude()
  longitude?: number | null;
}

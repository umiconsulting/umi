import {
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * A café's second branch.
 *
 * Only the name is required. A café that has just signed a lease knows what it will
 * call the place long before anyone has stood on the corner with a phone, and a
 * branch with no pin is a branch that exists — `merchant.location.lat/lng` are
 * nullable for exactly that reason. Everything here can be filled in later through
 * `UpdateLocationDto`.
 *
 * No `status`: a branch is opened open. Closing one is an edit, not a creation.
 */
export class CreateLocationDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

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

  // Null = inherit `merchant.merchant.timezone`, which is what almost every café
  // wants; a branch in another timezone sets its own.
  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string | null;
}

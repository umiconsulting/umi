import { Type } from 'class-transformer';
import {
  IsArray,
  IsEmail,
  IsIn,
  IsISO8601,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class ProvisionLocationDto {
  @IsString()
  @Length(1, 100)
  name!: string;

  @IsOptional()
  @IsString()
  @Length(0, 200)
  address?: string;

  @IsOptional()
  @IsLatitude()
  latitude?: number;

  @IsOptional()
  @IsLongitude()
  longitude?: number;
}

/**
 * What it takes to open a café.
 *
 * ⚠️ NO SLUG, AND THAT IS THE DESIGN. umi-cash's form required one and wrote it
 * to `core.tenants.slug`. build-v3 replaced that with `merchant.merchant.handle`,
 * which is nullable, UNIQUE, and deliberately NOT auto-assigned: it exists only
 * because 350 issued Apple Wallet passes carry a café's name inside a signed URL
 * that can never be recalled. A café opened today has no such passes, is reached
 * by id, and must not add a row to a column designed to stop growing.
 *
 * NO TIMEZONE LOOKUP EITHER. The old route derived one from the first location's
 * coordinates via `tz-lookup`, a dependency AB#108 retires. The timezone is asked
 * for instead, because the person filling this in knows it and a geocoder does
 * not know which timezone a café keeps its books in.
 */
export class ProvisionMerchantDto {
  @IsString()
  @Length(2, 100)
  name!: string;

  @IsOptional()
  @IsString()
  @Length(0, 100)
  city?: string;

  @IsOptional()
  @IsString()
  @Length(1, 64)
  timezone?: string;

  /** Which plan they bought. The plan decides the products — see `umi.plan_feature`. */
  @IsString()
  @IsIn(['starter', 'growth', 'pro'])
  plan!: string;

  /** Set for a trial; the subscription then opens `trialing` and ends here. */
  @IsOptional()
  @IsISO8601()
  trialEndsAt?: string;

  @IsString()
  @Length(2, 5)
  @Matches(/^[A-Z]+$/, { message: 'cardPrefix must be upper-case letters' })
  cardPrefix!: string;

  @IsString()
  @Matches(/^#[0-9A-Fa-f]{6}$/, { message: 'primaryColor must be a #rrggbb colour' })
  primaryColor!: string;

  @IsOptional()
  @IsString()
  @Matches(/^#[0-9A-Fa-f]{6}$/, { message: 'secondaryColor must be a #rrggbb colour' })
  secondaryColor?: string;

  @IsEmail()
  adminEmail!: string;

  @IsString()
  @Length(8, 100)
  adminPassword!: string;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  adminName?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  stampsRequired?: number;

  @IsOptional()
  @IsString()
  @Length(2, 100)
  rewardName?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProvisionLocationDto)
  locations?: ProvisionLocationDto[];
}

import { Transform, Type } from 'class-transformer';
import {
  IsDefined,
  IsObject,
  IsOptional,
  IsString,
  Length,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

/**
 * The per-customer reward. It changes the reward name only, never the threshold.
 * `resolveRewardProfile` keeps `visitsRequired` from the café default.
 */
export class CustomRewardDto {
  // Trim before validation, so a name of spaces cannot pass the length check.
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, 80)
  name!: string;

  // An empty description becomes null, the same value the old route stored.
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() || null : value))
  @IsOptional()
  @IsString()
  @Length(0, 200)
  description?: string | null;
}

/**
 * The body of `PATCH /api/:merchantRef/admin/customers/:id`.
 *
 * `null` clears the override. An object sets it. A missing key is invalid,
 * because a clear and a no-op must not look the same.
 */
export class CustomerRewardOverrideDto {
  @IsDefined()
  @ValidateIf((o: CustomerRewardOverrideDto) => o.customReward !== null)
  @IsObject()
  @ValidateNested()
  @Type(() => CustomRewardDto)
  customReward!: CustomRewardDto | null;
}

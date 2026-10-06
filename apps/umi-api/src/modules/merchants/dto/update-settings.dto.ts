import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Matches, Max, Min, ValidateNested } from 'class-validator';

/**
 * Owner-tuned customer-segment cutoffs. Every field is optional: the API merges
 * whatever is sent over the code defaults (customer-kpis.ts SEGMENT_THRESHOLDS), so
 * an owner can set just the ones they care about. Bounds keep a stray input from
 * making the classifier nonsensical.
 */
export class SegmentThresholdsDto {
  /** No order for this many days → Lapsed. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3650)
  lapsedDays?: number;

  /** Last visit within this many days counts as "currently active". */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  activeWindowDays?: number;

  /** Distinct visits at or above this, while active → at least Regular. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  regularMinVisits?: number;

  /** Visits at or above this, plus the spend floor, while active → VIP. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10000)
  vipMinVisits?: number;

  /** Lifetime spend (centavos) at or above this, plus the visit floor → VIP. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000_000)
  vipMinSpendCents?: number;
}

export class UpdateSettingsDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  timezone?: string;

  // The hour the trading day rolls over (merchant.business_day_start). `00:00` = the day
  // ends at local midnight; a late-night café sets e.g. `04:00` so a 2 a.m. sale belongs to
  // the night that opened it. Validated as HH:MM in 24-hour time.
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'businessDayStart must be HH:MM in 24-hour time (00:00–23:59)',
  })
  businessDayStart?: string;

  // Owner-tunable customer-segment cutoffs (merchant.segment_thresholds).
  @IsOptional()
  @ValidateNested()
  @Type(() => SegmentThresholdsDto)
  segmentThresholds?: SegmentThresholdsDto;
}

import { IsOptional, IsString, Matches } from 'class-validator';

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
}

import { Type } from 'class-transformer';
import type { HoursGrid } from '../../business-hours/open-hours';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsLatitude,
  IsLongitude,
  IsObject,
  IsOptional,
  IsString,
  IsTimeZone,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export class CashPlatformLocationDto {
  @IsOptional() @IsUUID() id?: string;
  @IsString() @Length(1, 100) name!: string;
  @IsOptional() @IsString() @Length(0, 200) address?: string | null;
  @IsOptional() @IsLatitude() latitude?: number | null;
  @IsOptional() @IsLongitude() longitude?: number | null;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class CashPlatformUpdateDto {
  @ValidateIf((o) => o.name !== undefined) @IsString() @Length(2, 100) name?: string;
  @ValidateIf((o) => o.city !== undefined) @IsString() @Length(0, 100) city?: string;
  @ValidateIf((o) => o.timezone !== undefined) @IsTimeZone() timezone?: string;
  @ValidateIf((o) => o.primaryColor !== undefined)
  @Matches(/^#[0-9A-Fa-f]{6}$/)
  primaryColor?: string;
  @IsOptional() @Matches(/^#[0-9A-Fa-f]{6}$/) secondaryColor?: string | null;
  @ValidateIf((o) => o.selfRegistration !== undefined) @IsBoolean() selfRegistration?: boolean;
  @ValidateIf((o) => o.topupEnabled !== undefined) @IsBoolean() topupEnabled?: boolean;
  @IsOptional() @IsObject() businessHours?: HoursGrid | null;
  @ValidateIf((o) => o.subscriptionStatus !== undefined)
  @IsIn(['ACTIVE', 'SUSPENDED', 'TRIAL'])
  subscriptionStatus?: 'ACTIVE' | 'SUSPENDED' | 'TRIAL';
  @IsOptional() @IsISO8601() trialEndsAt?: string | null;
  @ValidateIf((o) => o.rewardName !== undefined || o.visitsRequired !== undefined)
  @IsString()
  @Length(2, 100)
  rewardName?: string;
  @ValidateIf((o) => o.rewardName !== undefined || o.visitsRequired !== undefined)
  @IsInt()
  @Min(1)
  @Max(50)
  visitsRequired?: number;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CashPlatformLocationDto)
  locations?: CashPlatformLocationDto[];
}

export class CashBroadcastDto {
  @IsString() @Length(1, 64) reference!: string;
  @IsString() @Length(1, 200) message!: string;
  @IsOptional() @IsBoolean() dryRun?: boolean;
}

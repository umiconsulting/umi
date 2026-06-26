import { IsISO8601, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class RegisterDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name!: string;

  @IsString()
  @MinLength(7)
  @MaxLength(20)
  phone!: string;

  // @Matches pins the date-only shape; @IsISO8601 strict rejects impossible
  // calendar dates (e.g. 2026-02-30) that would otherwise 500 on the $3::date cast.
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'birthDate must be YYYY-MM-DD' })
  @IsISO8601({ strict: true })
  birthDate!: string;
}

export class GiftRedeemDto {
  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  email?: string;
}

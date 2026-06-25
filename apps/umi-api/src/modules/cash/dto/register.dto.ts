import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class RegisterDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name!: string;

  @IsString()
  @MinLength(7)
  @MaxLength(20)
  phone!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/)
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

import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * umi-cash's login body, bounds included. `identifier` is an email address today;
 * the name is umi-cash's and the frozen client sends that key, so it stays.
 */
export class CashLoginDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  identifier!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  password!: string;
}

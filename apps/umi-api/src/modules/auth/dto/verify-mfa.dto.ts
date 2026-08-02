import { IsBoolean, IsOptional, IsString, Matches, MinLength } from 'class-validator';

export class VerifyMfaDto {
  /** The half-authenticated token returned by `POST local/login`. */
  @IsString()
  @MinLength(1)
  challengeToken!: string;

  /**
   * Exactly six digits. Validated at the edge so a malformed body never reaches the
   * HMAC comparison, and so a caller cannot spend an attempt on input that could
   * never have matched.
   */
  @IsString()
  @Matches(/^\d{6}$/, { message: 'code must be 6 digits' })
  code!: string;

  /** Carried through from the first step; same meaning as on LoginDto. */
  @IsOptional()
  @IsBoolean()
  remember?: boolean;
}

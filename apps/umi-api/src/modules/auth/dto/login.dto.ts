import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @IsString()
  username!: string;

  @IsString()
  @MinLength(1)
  password!: string;

  /**
   * "Remember me" — when true, the auth cookies are persistent (survive a
   * browser restart, up to the refresh TTL). When false/absent they are session
   * cookies, cleared when the browser closes.
   */
  @IsOptional()
  @IsBoolean()
  remember?: boolean;
}

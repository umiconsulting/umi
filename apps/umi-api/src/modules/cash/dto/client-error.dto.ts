import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

/** umi-cash reports exactly these three kinds; anything else is a client bug. */
const KINDS = ['offline', 'unreachable', 'malformed'];

/**
 * A failure only the register's screen could see. The lengths are umi-cash's, and
 * they are the abuse control: the endpoint writes to the platform log, so an
 * unbounded `detail` is an unbounded write.
 */
export class ClientErrorDto {
  @IsString()
  @MaxLength(40)
  action!: string;

  @IsIn(KINDS)
  kind!: string;

  @IsString()
  @MaxLength(300)
  detail!: string;

  /** The browser's own `navigator.onLine` at the moment it failed. */
  @IsOptional()
  @IsBoolean()
  online?: boolean | null;
}

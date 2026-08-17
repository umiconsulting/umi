import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsOptional, IsString } from 'class-validator';

const ACTIONS = ['VISIT', 'REDEEM', 'BIRTHDAY_REDEEM'];

export class ScanDto {
  @IsString()
  qrPayload!: string;

  @IsOptional()
  @IsIn(ACTIONS)
  action?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  @IsIn(ACTIONS, { each: true })
  actions?: string[];
}

/**
 * Preview takes only the identifier. It performs no action, so it carries none:
 * the register decides what to commit AFTER staff read what came back.
 */
export class ScanPreviewDto {
  @IsString()
  qrPayload!: string;
}

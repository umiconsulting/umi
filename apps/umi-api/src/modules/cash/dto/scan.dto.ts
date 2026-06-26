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

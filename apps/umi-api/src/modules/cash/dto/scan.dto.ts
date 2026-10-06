import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const ACTIONS = ['VISIT', 'REDEEM', 'BIRTHDAY_REDEEM'] as const;
type ScanAction = (typeof ACTIONS)[number];

export class ScanDto {
  @IsString()
  qrPayload!: string;

  @IsOptional()
  @IsIn(ACTIONS)
  action?: ScanAction;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  @IsIn(ACTIONS, { each: true })
  actions?: ScanAction[];
}

/**
 * Preview takes only the identifier. It performs no action, so it carries none:
 * the register decides what to commit AFTER staff read what came back.
 */
export class ScanPreviewDto {
  @IsString()
  qrPayload!: string;
}

/**
 * A manual bulk stamp credit. The cap is 50 because a migrating customer may
 * carry a couple of full cards' worth, and a fat-fingered entry should not be
 * able to mint more. `merchant.loyalty_visit.stamps` carries the same CHECK, so
 * the bound holds even if a caller reaches the database another way.
 *
 * The card is named by id, not by a scanned code: the register has already
 * previewed the card, so staff are crediting a customer they have identified.
 */
export class ScanSealsDto {
  @IsUUID()
  cardId!: string;

  @IsInt()
  @Min(1)
  @Max(50)
  seals!: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;

  /**
   * Makes a retried credit land once. Short keys are refused because the whole
   * guarantee rests on the key being unguessably unique per action.
   */
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(200)
  idempotencyKey?: string;
}

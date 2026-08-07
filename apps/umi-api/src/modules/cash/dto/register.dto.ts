import {
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  Validate,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
  type ValidationArguments,
} from 'class-validator';
import { nationalDigitsAreValid, phoneLengthMessage } from '@umi/contract';

/**
 * The customer typed a phone number. It must carry the digit count its country uses —
 * for Mexico exactly 10, because the `+52` comes from the picker and never from the
 * keyboard.
 *
 * The rule itself lives in `@umi/contract` so this DTO and the zod
 * `RegisterMemberRequest` cannot drift. Both previously said `min(7).max(20)`, which is
 * a STRING LENGTH and admits 8, 9, 11 and 12 national digits — four real customers
 * registered exactly those, and `umi.e164` then stored them as valid-looking E.164
 * numbers that reach nobody.
 */
@ValidatorConstraint({ name: 'nationalDigits', async: false })
export class NationalDigitsRule implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return typeof value === 'string' && nationalDigitsAreValid(value);
  }

  defaultMessage(args: ValidationArguments): string {
    return phoneLengthMessage(typeof args.value === 'string' ? args.value : '');
  }
}

export class RegisterDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name!: string;

  @IsString()
  @MinLength(7)
  @MaxLength(20)
  @Validate(NationalDigitsRule)
  phone!: string;

  // @Matches pins the date-only shape; @IsISO8601 strict rejects impossible
  // calendar dates (e.g. 2026-02-30) that would otherwise 500 on the $3::date cast.
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'birthDate must be YYYY-MM-DD' })
  @IsISO8601({ strict: true })
  birthDate!: string;
}

/**
 * Gift redemption LOOKS UP an existing contact; it does not create one. The digit rule
 * is deliberately NOT applied here — a customer whose number was recorded before that
 * rule existed must still be able to redeem their own balance.
 */
export class GiftRedeemDto {
  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  email?: string;
}

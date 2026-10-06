/**
 * The rule for a phone number a CUSTOMER types into a registration form.
 *
 * One author, two consumers: the zod schema in `schemas.ts` and the class-validator
 * DTO in umi-api both call `nationalDigitsAreValid`. They used to state the rule
 * separately, as `min(7).max(20)` on each side — a STRING LENGTH, which is not a rule
 * about phone numbers at all.
 *
 * WHAT WENT WRONG WITHOUT IT. The registration form has a country picker and a national
 * field, and submits `+${dial}${digits}`. Nothing checked how many digits. Four real
 * customers registered Mexican numbers with 8, 11, 11 and 12 national digits — plain
 * typos — and every one was accepted. `umi.e164` then had no reason to reject them
 * either: its `+52` rule only recognises the correct length, so a wrong-length number
 * falls through to the generic "11..15 digits, keep as international" branch and is
 * stored as a valid-looking E.164 that reaches nobody. Only the 8-digit one was short
 * enough to miss that branch, which is the sole reason it is the one honest NULL in the
 * table.
 *
 * A fabricated E.164 is worse than a rejected one: it is syntactically deliverable, so
 * it can route to a real person who never signed up.
 *
 * WHERE THIS DOES AND DOES NOT APPLY.
 *   - APPLIES to customer registration, which is a person typing digits.
 *   - Does NOT apply to a WhatsApp inbound address. Twilio delivers Mexican mobiles as
 *     `+521` + 10 digits (13 digits), which is correct for that channel and is stripped
 *     back to `+52` + 10 by `umi.e164`.
 *   - Does NOT apply to gift-card redemption, which LOOKS UP an existing contact. A
 *     customer whose number was recorded wrong before this rule existed must still be
 *     able to redeem; tightening a lookup would lock them out of their own balance.
 */

/** Country codes the registration picker offers, longest first so `52` cannot shadow `521`. */
const DIAL_CODES = [
  '593',
  '502',
  '503',
  '504',
  '505',
  '506',
  '507',
  '591',
  '595',
  '598',
  '52',
  '34',
  '54',
  '57',
  '56',
  '51',
  '58',
  '1',
] as const;

/**
 * How many NATIONAL digits a country's numbers carry. Mexico is the rule this exists
 * for: every Mexican number is exactly 10 digits, and the customer types those 10 —
 * the `+52` comes from the picker, never from the keyboard.
 *
 * A country absent from this map is not rejected; it falls back to the ITU E.164
 * general bound below. Guessing a length for a country nobody has registered from
 * would reject real customers to enforce a rule we did not verify.
 */
const NATIONAL_DIGITS: Record<string, number> = {
  '52': 10, // México
  '1': 10, // EE. UU. / Canadá / Rep. Dominicana (NANP)
};

/** ITU-T E.164: at most 15 digits including the country code. */
const E164_MAX_TOTAL_DIGITS = 15;
/** Shortest national number in use anywhere. Deliberately permissive. */
const MIN_NATIONAL_DIGITS = 6;

export interface PhoneParts {
  dial: string;
  national: string;
}

/** Split an assembled `+<dial><national>` into its two halves. Null when unparseable. */
export function splitPhone(raw: string): PhoneParts | null {
  const digits = (raw ?? '').replace(/\D/g, '');
  if (!digits) return null;
  for (const dial of DIAL_CODES) {
    if (digits.startsWith(dial)) return { dial, national: digits.slice(dial.length) };
  }
  return null;
}

/**
 * True when the national part has the digit count its country actually uses.
 *
 * Accepts a raw assembled number (`+525512345678`). A number whose country the picker
 * does not offer is judged only against the E.164 bounds — see NATIONAL_DIGITS.
 */
export function nationalDigitsAreValid(raw: string): boolean {
  const digits = (raw ?? '').replace(/\D/g, '');
  if (digits.length > E164_MAX_TOTAL_DIGITS) return false;

  const parts = splitPhone(raw);
  if (!parts) return false;

  const expected = NATIONAL_DIGITS[parts.dial];
  if (expected !== undefined) return parts.national.length === expected;
  return parts.national.length >= MIN_NATIONAL_DIGITS;
}

/** What the customer is told. Names the country's rule, so the typo is correctable. */
export function phoneLengthMessage(raw: string): string {
  const parts = splitPhone(raw);
  const expected = parts ? NATIONAL_DIGITS[parts.dial] : undefined;
  if (parts && expected !== undefined) {
    return `El número debe tener exactamente ${expected} dígitos, sin el código de país.`;
  }
  return 'Ingresa un número de teléfono válido, sin el código de país.';
}

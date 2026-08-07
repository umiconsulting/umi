import { describe, expect, it } from 'vitest';
import { validateSync } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { RegisterDto } from './register.dto';

/**
 * The digit rule, checked against the numbers that actually got into production.
 *
 * Every rejected case below is a REAL row in `merchant.contact`. They were accepted
 * because both this DTO and the contract schema validated the phone as a string of
 * length 7..20 — a rule about characters, not about phone numbers. `umi.e164` then
 * turned each one into a valid-looking E.164 that reaches nobody, because its `+52`
 * branch only recognises the correct length and everything else falls through to the
 * generic international branch.
 */

const dto = (phone: string): RegisterDto =>
  plainToInstance(RegisterDto, { name: 'Ana Torres', phone, birthDate: '1994-03-02' });

const errorsFor = (phone: string): string[] =>
  validateSync(dto(phone)).flatMap((e) => Object.values(e.constraints ?? {}));

const accepts = (phone: string): boolean => errorsFor(phone).length === 0;

describe('RegisterDto.phone · the country picker supplies the code, the customer types the digits', () => {
  it('accepts a Mexican number with exactly 10 national digits', () => {
    expect(accepts('+525512345678')).toBe(true);
    expect(accepts('+526671518408')).toBe(true);
  });

  it.each([
    ['+5266748626', 8, 'Mayela'],
    ['+52787878787', 9, 'azaza'],
    ['+5266716222762', 11, 'Gema Hernández'],
    ['+5266718054238', 11, 'Jacqueline Soto'],
    ['+52556672675598', 12, 'Kristel Ortiz'],
  ])('rejects %s — %i national digits (%s got in this way)', (phone) => {
    expect(accepts(phone)).toBe(false);
  });

  it('tells the customer the exact count, so a typo is correctable', () => {
    expect(errorsFor('+5266748626').join(' ')).toContain('10 dígitos');
  });

  it('accepts a NANP number at 10 national digits and rejects 9', () => {
    expect(accepts('+14804016182')).toBe(true);
    expect(accepts('+1480401618')).toBe(false);
  });

  it('does not guess a length for a country the picker offers but we never measured', () => {
    // Spain (+34) is not in NATIONAL_DIGITS: judged only on the E.164 bounds, so a
    // real 9-digit Spanish number is accepted rather than rejected by a guess.
    expect(accepts('+34612345678')).toBe(true);
  });

  it('rejects anything past the E.164 ceiling of 15 digits', () => {
    expect(accepts('+5255123456789012')).toBe(false);
  });

  it('still rejects an empty or junk phone', () => {
    expect(accepts('')).toBe(false);
    expect(accepts('no soy un teléfono')).toBe(false);
  });

  it('leaves the other fields alone — only the phone rule changed', () => {
    expect(errorsFor('+525512345678')).toEqual([]);
    const badDate = plainToInstance(RegisterDto, {
      name: 'Ana Torres',
      phone: '+525512345678',
      birthDate: '2026-02-30',
    });
    expect(validateSync(badDate).length).toBeGreaterThan(0);
  });
});

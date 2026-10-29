import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { ContactDto } from './contact.dto';

describe('ContactDto', () => {
  it('keeps the optional WhatsApp number and accepted notice after validation', async () => {
    const dto = plainToInstance(ContactDto, {
      name: 'Ana',
      email: 'ana@example.com',
      company: 'ONCA',
      phone: '+52 667 000 0000',
      privacyAccepted: true,
    });
    expect(await validate(dto, { whitelist: true })).toEqual([]);
    expect(dto.phone).toBe('+52 667 000 0000');
    expect(dto.privacyAccepted).toBe(true);
  });

  it('rejects an explicit refusal of the notice', async () => {
    const dto = plainToInstance(ContactDto, {
      name: 'Ana',
      email: 'ana@example.com',
      privacyAccepted: false,
    });
    const errors = await validate(dto, { whitelist: true });
    expect(errors.some((error) => error.property === 'privacyAccepted')).toBe(true);
  });
});

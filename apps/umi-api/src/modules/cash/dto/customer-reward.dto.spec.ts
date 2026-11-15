import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { CustomerRewardOverrideDto } from './customer-reward.dto';

const dto = (body: unknown) => plainToInstance(CustomerRewardOverrideDto, body);

describe('customer reward override body', () => {
  it('accepts an object and trims the text', async () => {
    const value = dto({ customReward: { name: '  Postre gratis  ', description: '  VIP  ' } });
    await expect(validate(value)).resolves.toHaveLength(0);
    expect(value.customReward).toMatchObject({ name: 'Postre gratis', description: 'VIP' });
  });

  it('turns an empty description into null', async () => {
    const value = dto({ customReward: { name: 'Postre gratis', description: '   ' } });
    await expect(validate(value)).resolves.toHaveLength(0);
    expect(value.customReward?.description).toBeNull();
  });

  it('accepts null to clear the override', async () => {
    const value = dto({ customReward: null });
    await expect(validate(value)).resolves.toHaveLength(0);
    expect(value.customReward).toBeNull();
  });

  it('rejects a missing customReward key', async () => {
    const errors = await validate(dto({}));
    expect(errors.some((error) => error.property === 'customReward')).toBe(true);
  });

  it('rejects a name of spaces', async () => {
    const errors = await validate(dto({ customReward: { name: '   ' } }));
    expect(errors.some((error) => error.property === 'customReward')).toBe(true);
  });

  it('rejects a name over 80 characters', async () => {
    const errors = await validate(dto({ customReward: { name: 'x'.repeat(81) } }));
    expect(errors.some((error) => error.property === 'customReward')).toBe(true);
  });

  it('rejects a description over 200 characters', async () => {
    const errors = await validate(
      dto({ customReward: { name: 'Postre gratis', description: 'x'.repeat(201) } }),
    );
    expect(errors.some((error) => error.property === 'customReward')).toBe(true);
  });
});

import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { UpdateSettingsDto } from './update-settings.dto';

describe('UpdateSettingsDto purchase days', () => {
  it.each([[], [0], [1, 4], [0, 1, 2, 3, 4, 5, 6]].map((purchaseDays) => ({ purchaseDays })))(
    'accepts a weekly selection $purchaseDays',
    ({ purchaseDays }) => {
      expect(validateSync(plainToInstance(UpdateSettingsDto, { purchaseDays }))).toEqual([]);
    },
  );

  it.each(
    [null, '1,4', ['1', 4], [-1], [7], [1.5], [1, 1], [null], [[1]], [0, 1, 2, 3, 4, 5, 6, 0]].map(
      (purchaseDays) => ({ purchaseDays }),
    ),
  )('rejects invalid purchase days $purchaseDays', ({ purchaseDays }) => {
    expect(validateSync(plainToInstance(UpdateSettingsDto, { purchaseDays }))).not.toEqual([]);
  });

  it('allows unrelated settings patches without a purchase-day value', () => {
    const dto = plainToInstance(UpdateSettingsDto, { name: 'Café Centro' });
    expect(validateSync(dto)).toEqual([]);
    expect(dto.purchaseDays).toBeUndefined();
  });
});

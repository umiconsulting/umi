import 'reflect-metadata';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AuthGuard } from '../auth/auth.guard';
import { PlatformAdminGuard } from '../auth/platform-admin.guard';
import { CashPlatformRepository } from './cash-platform.repository';
import { CashPlatformController } from './cash-platform.controller';
import { CashPlatformUpdateDto } from './dto/cash-platform-update.dto';

describe('Cash internal administration boundary', () => {
  it('requires canonical identity and platform administrator authority on every route', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, CashPlatformController)).toEqual([
      AuthGuard,
      PlatformAdminGuard,
    ]);
  });

  it('rejects a partial reward edit and invalid location ownership identifiers', async () => {
    const input = plainToInstance(CashPlatformUpdateDto, {
      rewardName: 'New reward',
      locations: [{ id: 'legacy-id', name: 'Branch' }],
    });
    const errors = await validate(input);
    expect(errors.map((error) => error.property)).toEqual(
      expect.arrayContaining(['visitsRequired', 'locations']),
    );
  });
  it('rejects malformed opening hours before a database write', async () => {
    const repo = new CashPlatformRepository({} as never);
    for (const from of [123, '08:30extra']) {
      await expect(
        repo.update(
          'unused',
          {
            businessHours: { mon: { open: true, from, to: '20:00' } },
          } as unknown as CashPlatformUpdateDto,
          async () => undefined,
        ),
      ).rejects.toMatchObject({ status: 400 });
    }
  });
});

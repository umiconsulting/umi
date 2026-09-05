import { GUARDS_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';
import { PERMISSION_KEY } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { StaffMerchantController } from './staff-merchant.controller';
import { StaffController } from './staff.controller';
import { MerchantRolesController } from './roles.controller';

describe.each([StaffController, StaffMerchantController, MerchantRolesController])(
  '%s authorization',
  (controller) => {
    it('requires merchant.manage through RolesGuard', () => {
      expect(Reflect.getMetadata(PERMISSION_KEY, controller)).toBe('merchant.manage');
      expect(Reflect.getMetadata(GUARDS_METADATA, controller)).toContain(RolesGuard);
    });
  },
);

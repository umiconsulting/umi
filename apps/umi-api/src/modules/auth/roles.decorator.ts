import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'umi:roles';
export const PERMISSION_KEY = 'umi:permission';

/** Require the membership's effective role to be one of `roles`. */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);

/** Require a specific permission key (super_admin's `*` always passes). */
export const RequirePermission = (permission: string) =>
  SetMetadata(PERMISSION_KEY, permission);

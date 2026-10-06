import { ForbiddenException } from '@nestjs/common';
import type { MerchantAccess } from './auth.types';

export const LOCATION_SWITCH_PERMISSION = 'location.switch';

export function canSwitchLocations(access: MerchantAccess): boolean {
  return (
    access.permissions.includes(LOCATION_SWITCH_PERMISSION) || access.permissions.includes('*')
  );
}

/** Resolve a requested branch against server-side employment and role authority. */
export function resolveLocationAuthority(
  access: MerchantAccess,
  requestedLocationId?: string | null,
): string | null {
  if (canSwitchLocations(access)) return requestedLocationId || access.locationId || null;
  if (!access.locationId) {
    throw new ForbiddenException({ error: 'location_scope_required' });
  }
  if (requestedLocationId && requestedLocationId !== access.locationId) {
    throw new ForbiddenException({ error: 'location_switch_denied' });
  }
  return access.locationId;
}

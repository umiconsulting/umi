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

/**
 * The branch filter a merchant-scoped READ hands to its query: one branch, every branch
 * the caller may switch to, or none at all.
 *
 * `[]` is not `null`. An empty array matches no row, which is the right answer for a
 * caller pinned to a branch that does not exist; `null` means "unscoped" and would hand
 * that caller the whole merchant. Callers must pass the result straight into an
 * `IS NULL OR x = any($n)` predicate, never through a truthiness check.
 */
export function locationScopeFor(
  access: MerchantAccess,
  requestedLocationId?: string | null,
): string[] | null {
  const locationId = resolveLocationAuthority(access, requestedLocationId);
  if (locationId) return [locationId];
  return canSwitchLocations(access) ? null : [];
}

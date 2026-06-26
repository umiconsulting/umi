/**
 * Role model (ported from server.js `normalizeRoleKey`). Roles are edges in
 * `core.tenant_memberships`/`membership_roles` — never a column on a person.
 * Precedence is highest-first; `super_admin` implies all permissions (`*`).
 */
export const ROLE_PRECEDENCE = [
  'super_admin',
  'owner',
  'admin',
  'developer',
  'tech_assist',
  'staff',
] as const;

export type RoleKey = (typeof ROLE_PRECEDENCE)[number] | string;

/** The single most-privileged role from a membership's role set. */
export function normalizeRoleKey(roles: string[] | null | undefined): string | null {
  if (!roles?.length) return null;
  for (const role of ROLE_PRECEDENCE) {
    if (roles.includes(role)) return role;
  }
  return roles[0];
}

/** Effective permission list — super_admin gets the wildcard. */
export function effectivePermissions(
  role: string | null,
  permissions: string[],
): string[] {
  return role === 'super_admin' ? ['*'] : permissions;
}

export function hasPermission(granted: string[], required: string): boolean {
  return granted.includes('*') || granted.includes(required);
}

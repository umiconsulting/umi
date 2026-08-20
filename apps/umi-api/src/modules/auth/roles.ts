/**
 * Role model. A role is now a single enum value on the `tenant.tenant_access`
 * edge (one role per login per tenant) — never a column on a person.
 * Precedence is highest-first; `super_admin` implies all permissions (`*`).
 * `developer`/`tech_assist` are PARKED at the DB layer (not admitted to the
 * tenant_access / role_permission CHECKs) — kept here inert for forward-compat
 * so promoting them later is a pure DDL change with zero code churn.
 */
export const ROLE_PRECEDENCE = [
  'super_admin',
  'owner',
  'admin',
  'developer',
  'tech_assist',
  'staff',
  'viewer',
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

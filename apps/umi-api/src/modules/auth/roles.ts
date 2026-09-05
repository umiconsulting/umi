/**
 * Role model. A merchant role is a `merchant.role` row, granted through the EMPLOYMENT
 * (`merchant.staff.merchant_role_id`) inside a café. A platform role stays in
 * `umi.role` and `umi.user_role`. One human may hold MANY roles across cafés,
 * so callers reduce the set with `normalizeRoleKey`; precedence is highest-first.
 * A `umi.user_role` grant is platform-wide by definition, which is how `super_admin`
 * and `developer` reach every merchant.
 *
 * Every key here has a `umi.role` row behind it (seed_rbac.sql). That is a rule, not a
 * coincidence: `normalizeRoleKey` returns the highest-precedence match, so a key with
 * no row would outrank a real role and then grant nothing, because no
 * `umi.role_permission` row exists for it. `tech_assist` was exactly that and is gone.
 */
export const ROLE_PRECEDENCE = [
  'super_admin',
  'owner',
  'admin',
  'manager',
  'supervisor',
  'cashier',
  'developer',
  'staff',
  'viewer',
] as const;

// `| string` would collapse the whole union to `string` and lose the literals.
// `(string & {})` keeps custom roles assignable — `normalizeRoleKey(['custom_role'])`
// is a supported case — while the known keys still surface in autocomplete.
export type RoleKey = (typeof ROLE_PRECEDENCE)[number] | (string & {});

/** The single most-privileged role from a membership's role set. */
export function normalizeRoleKey(roles: string[] | null | undefined): string | null {
  if (!roles?.length) return null;
  for (const role of ROLE_PRECEDENCE) {
    if (roles.includes(role)) return role;
  }
  return roles[0];
}

/**
 * Effective permission list. The catalog is the only source; no role is special here.
 *
 * This used to return `['*']` for super_admin. A wildcard grants permissions that did
 * not exist when it was written, and Umi paid for that: eight POS permission keys were
 * seeded in July 2026 and all eight reached super_admin the moment they existed, with
 * no review and no place where the decision would have appeared. Kubernetes documents
 * the same defect in its own RBAC.
 *
 * `seed_rbac.sql` now names super_admin's permissions one by one. The cost is real and
 * intended: a new permission key needs a seed row, or super_admin does not hold it.
 */
export function effectivePermissions(_role: string | null, permissions: string[]): string[] {
  return permissions;
}

/**
 * The `'*'` branch stays. Nothing produces `'*'` today, so it is unreachable — it is
 * kept as the single break-glass seam, so that a future time-boxed elevation grant has
 * exactly one place to plug into rather than needing this function changed under
 * pressure. See docs/reports/2026-08-01-platform-admin-and-support-access.md §8.4.
 */
export function hasPermission(granted: string[], required: string): boolean {
  return granted.includes('*') || granted.includes(required);
}

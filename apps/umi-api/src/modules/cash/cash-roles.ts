/** What the frozen umi-cash client understands. It knows no other value. */
export type LegacyRole = 'ADMIN' | 'STAFF';

/**
 * Canonical build-v3 role keys → the legacy role the register reads.
 *
 * ADMIN is tested FIRST so it wins when someone holds both. A café owner who is
 * also listed as staff is an owner; deciding by array order would hide the money
 * screens from her depending on how the rows came back.
 *
 * `super_admin` is deliberately NOT here, matching umi-cash. It is a platform
 * grant, not a café role, and a platform account is not a till login. Note this
 * differs from `STAFF_ROLES` in the scan and admin controllers, which DO admit
 * super_admin — those authorise an already-authenticated dashboard user acting on
 * a café, which is a different question from who may open a register session.
 */
export function legacyRole(roleKeys: string[]): LegacyRole | null {
  if (roleKeys.some((k) => k === 'owner' || k === 'admin')) return 'ADMIN';
  if (roleKeys.some((k) => k === 'staff' || k === 'cashier')) return 'STAFF';
  return null;
}

/**
 * The role to REPORT to the register, from whatever the guard put on the request.
 *
 * A till session already carries `role` in the register's own vocabulary, while a
 * dashboard or API session carries build-v3 role keys — and the dashboard reaches
 * the same `stats` route through `/api/merchants/:id/cash/stats`. Both must answer
 * the value the frozen panel reads (`ADMIN`/`STAFF`), never a build-v3 key.
 */
export function registerRole(access: { role: string | null; roles: string[] }): LegacyRole | null {
  const mapped = legacyRole(access.roles);
  if (mapped) return mapped;
  return access.role === 'ADMIN' || access.role === 'STAFF' ? access.role : null;
}

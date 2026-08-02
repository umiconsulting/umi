/**
 * Shared SQL fragments for the RBAC "global operator" gate.
 *
 * `PLATFORM_GRANT_CTE` is the single source of truth for platform-operator detection —
 * a security-sensitive predicate that grants a login visibility and authority over
 * every merchant. It was copy-pasted verbatim across `findMerchantsForUser`,
 * `findMembershipAccess`, and `MerchantsRepository.merchantsForUser`; three
 * independent copies risk silently diverging. Interpolate it into a `WITH` clause;
 * it expects the login id as `$1` and exposes `(SELECT platform_role FROM sa)`.
 *
 * It returns the ROLE KEY, not a boolean, because there is more than one platform role
 * and they differ in authority:
 *   super_admin  every platform permission (seed_rbac.sql grants them one by one)
 *   developer    read-only: reach every café, change nothing
 * A boolean could only ever mean "super_admin", which is what it used to mean, and
 * which is why `developer` sat in ROLE_PRECEDENCE for months granting nothing.
 * NULL means the user holds no live platform grant.
 *
 * `umi.user_role` holds ONLY platform grants now (a café role lives on
 * `merchant.staff.role_id`), so this needs no merchant predicate — every row in the
 * table is already cross-merchant by construction. `r.is_platform` is belt-and-braces:
 * the composite FK on `umi.user_role` already refuses a café role.
 *
 * THE LIFETIME PREDICATE LIVES HERE, AND NOWHERE ELSE.
 * `umi.user_role` carries `expires_at` and `revoked_at`, and PostgreSQL enforces
 * neither: `VALID UNTIL` applies to a password, not to a role, and no DDL construct
 * expires a row. So an expired grant is still a row, and a query that does not exclude
 * it hands out cross-merchant authority forever. Both predicates below are the whole
 * mechanism. Removing either one silently restores permanent access.
 */
export const PLATFORM_GRANT_CTE = `sa AS (
         SELECT (
           SELECT r.key
           FROM umi.user_role AS ur
           JOIN umi.role AS r ON r.id = ur.role_id
           WHERE ur.user_id = $1::uuid
             AND r.is_platform
             AND ur.revoked_at IS NULL
             AND (ur.expires_at IS NULL OR ur.expires_at > now())
           ORDER BY CASE r.key WHEN 'super_admin' THEN 0 ELSE 1 END
           LIMIT 1
         ) AS platform_role
       )`;

/** True when the user holds any live platform grant. Interpolate inside a WHERE. */
export const HAS_PLATFORM_GRANT = `(SELECT platform_role FROM sa) IS NOT NULL`;

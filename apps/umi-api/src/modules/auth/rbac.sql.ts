/**
 * Shared SQL fragments for the RBAC "global operator" gate.
 *
 * `SUPER_ADMIN_SA_CTE` is the single source of truth for super_admin detection —
 * a security-sensitive predicate that grants a login visibility/authority over
 * every tenant. It was copy-pasted verbatim across `findTenantsForUser`,
 * `findMembershipAccess`, and `TenantsRepository.tenantsForUser`; three
 * independent copies risk silently diverging. Interpolate it into a `WITH`
 * clause; it expects the login id as `$1` and exposes `(SELECT is_sa FROM sa)`.
 */
export const SUPER_ADMIN_SA_CTE = `sa AS (
         SELECT EXISTS (
           SELECT 1 FROM umi.user_role AS ur
           JOIN umi.role AS r ON r.id = ur.role_id
           WHERE ur.user_id = $1::uuid AND r.key = 'super_admin'
         ) AS is_sa
       )`;

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
           SELECT 1 FROM tenant.tenant_access
           WHERE login_id = $1::uuid AND role = 'super_admin' AND status = 'active'
         ) AS is_sa
       )`;

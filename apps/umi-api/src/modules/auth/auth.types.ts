/** Authenticated principal attached to the request by AuthGuard. */
export interface AuthUser {
  id: string;
  email: string;
}

/** Resolved tenant membership attached by TenantAccessGuard. */
export interface TenantAccess {
  tenantId: string;
  slug: string;
  name: string;
  timezone: string | null;
  membershipId: string;
  role: string | null;
  roles: string[];
  permissions: string[]; // ['*'] for super_admin
}

/**
 * The shape we mix into the Fastify request. Kept as an interface (not a
 * `declare module` augmentation) so guards/decorators read it explicitly via a
 * cast — avoids leaking auth types into every Fastify handler signature.
 */
export interface AuthedRequest {
  cookies?: Record<string, string | undefined>;
  params?: Record<string, string>;
  authUser?: AuthUser;
  tenantAccess?: TenantAccess;
}

export const ACCESS_COOKIE = 'umi_access';
export const REFRESH_COOKIE = 'umi_refresh';
export const CSRF_COOKIE = 'umi_csrf';
// "Remember me" marker. Lets /refresh preserve the session-vs-persistent choice
// made at login — a cookie's own maxAge isn't readable server-side.
export const REMEMBER_COOKIE = 'umi_remember';

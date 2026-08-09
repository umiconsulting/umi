/** Authenticated principal attached to the request by AuthGuard. */
export interface AuthUser {
  id: string;
  email: string;
  sessionId: string;
  deviceId: string | null;
}

/** Resolved merchant membership attached by MerchantAccessGuard. */
export interface MerchantAccess {
  merchantId: string;
  /** The published URL key. Null for a café created after cutover — route by id. */
  handle: string | null;
  name: string;
  timezone: string | null;
  // null for a synthesized global-super_admin access (no explicit edge in this
  // merchant). Client-informational only — never a DB write key.
  membershipId: string | null;
  role: string | null;
  roles: string[];
  permissions: string[];
}

/**
 * The shape we mix into the Fastify request. Kept as an interface (not a
 * `declare module` augmentation) so guards/decorators read it explicitly via a
 * cast — avoids leaking auth types into every Fastify handler signature.
 */
export interface AuthedRequest {
  cookies?: Record<string, string | undefined>;
  headers?: Record<string, string | string[] | undefined>;
  params?: Record<string, string>;
  query?: Record<string, unknown>;
  body?: Record<string, unknown>;
  authUser?: AuthUser;
  merchantAccess?: MerchantAccess;
}

export const ACCESS_COOKIE = 'umi_access';
export const REFRESH_COOKIE = 'umi_refresh';
export const CSRF_COOKIE = 'umi_csrf';
// "Remember me" marker. Lets /refresh preserve the session-vs-persistent choice
// made at login — a cookie's own maxAge isn't readable server-side.
export const REMEMBER_COOKIE = 'umi_remember';

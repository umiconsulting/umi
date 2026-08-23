/** Authenticated principal attached to the request by AuthGuard. */
export interface AuthUser {
  id: string;
  /**
   * Null for a register session. The till's token carries no address — it
   * authenticates a person at a café, not a mailbox — and every route that
   * accepts one reads `id`. `/auth/me` and MFA are dashboard-only and always
   * have it.
   */
  email: string | null;
  /**
   * The durable session this access token belongs to: the `runtime.session` row
   * id for a dashboard login, the POS session id for a PIN login. `''` for a
   * register session — the till's token (`JWT_ACCESS_SECRET`) names no session,
   * and no route that reads `sessionId` admits a till token (`@AcceptRegisterToken`
   * is opt-in and the POS controllers do not opt in).
   */
  sessionId: string;
  /** The enrolled POS device, or null for a dashboard or register session. */
  deviceId: string | null;
  commandContextType?: 'pos_device' | 'dashboard_administrative';
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
  /** Null grants merchant scope. A value limits this employment to one location. */
  locationId: string | null;
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
  /**
   * The café a register token was opened at, when one authenticated this
   * request. `MerchantAccessGuard` refuses a mismatch: a till session belongs to
   * one café even when the person behind it works at two.
   */
  registerMerchantId?: string;
}

export const ACCESS_COOKIE = 'umi_access';
export const REFRESH_COOKIE = 'umi_refresh';
export const CSRF_COOKIE = 'umi_csrf';
// "Remember me" marker. Lets /refresh preserve the session-vs-persistent choice
// made at login — a cookie's own maxAge isn't readable server-side.
export const REMEMBER_COOKIE = 'umi_remember';

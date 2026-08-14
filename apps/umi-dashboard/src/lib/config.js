// Central config — reads from Vite env vars (VITE_ prefix).
// Add values to .env — never commit secrets.

export const CFG = {
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL || '',
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY || '',
  merchantId: import.meta.env.VITE_MERCHANT_ID || '',
  merchantSlug: import.meta.env.VITE_MERCHANT_SLUG || '',
  // 'supabase' | 'local' (server.js, X-UMI-User-ID header) | 'cookie' (umi-api, httpOnly cookie)
  authMode: import.meta.env.VITE_AUTH_MODE || 'invalid',
  // Origin of the API backend. '' = same-origin (Vite proxy / server.js). For the umi-api
  // cutover set VITE_API_BASE=https://api.umiconsulting.co (used by 'cookie' mode).
  apiBase: (import.meta.env.VITE_API_BASE || '').replace(/\/+$/, ''),
  // cashApiBase is empty — cash routes ride the same apiUrl() base as everything else.
  cashApiBase: '',
  environment: import.meta.env.VITE_UMI_ENVIRONMENT || 'invalid',
  publicUrl: import.meta.env.VITE_PUBLIC_URL || '',
  release: Object.freeze({
    application: 'umi-dashboard',
    version: import.meta.env.VITE_RELEASE_VERSION || 'unavailable',
    gitCommit: import.meta.env.VITE_RELEASE_GIT_COMMIT || 'unavailable',
    buildTimestamp: import.meta.env.VITE_RELEASE_BUILD_TIMESTAMP || 'unavailable',
    contractVersion: import.meta.env.VITE_CONTRACT_VERSION || 'unavailable',
    configurationSchemaVersion: import.meta.env.VITE_CONFIG_SCHEMA_VERSION || 'unavailable',
  }),
};

export const LIVE = !!(CFG.supabaseUrl && CFG.supabaseAnonKey && CFG.merchantId);
export const CASH_LIVE = !!CFG.merchantSlug;

// umi-api backend: auth lives in an httpOnly cookie, requests are cross-origin with credentials.
export const COOKIE_AUTH = CFG.authMode === 'cookie';
// Both 'local' and 'cookie' keep the session *display data* (user/merchants) in localStorage.
export const LOCAL_SESSION = CFG.authMode === 'local' || COOKIE_AUTH;

/** Resolve an app-relative API path against the configured backend origin. */
export function apiUrl(path) {
  return CFG.apiBase + path;
}

/** Spread into every fetch() init so cross-origin cookies are sent in 'cookie' mode. */
export function withCreds(init) {
  return COOKIE_AUTH ? Object.assign({ credentials: 'include' }, init) : init || {};
}

/**
 * Pull a human-readable message out of an API error body. umi-api wraps errors
 * as `{ statusCode, error: { message, ... } }`, so `payload.error` is an OBJECT —
 * passing it straight to `new Error()` renders "[object Object]". server.js and
 * plain Nest responses use a string `error` or top-level `message`. Handle all.
 */
export function errMessage(payload, fallback = 'Error') {
  if (!payload || typeof payload !== 'object') return fallback;
  const e = payload.error;
  if (e && typeof e === 'object' && typeof e.message === 'string') return e.message;
  if (typeof e === 'string' && e) return e;
  if (typeof payload.message === 'string' && payload.message) return payload.message;
  return fallback;
}

// Central config — reads from Vite env vars (VITE_ prefix).
// Add values to .env — never commit secrets.

export const CFG = {
  businessId: import.meta.env.VITE_BUSINESS_ID || '',
  businessSlug: import.meta.env.VITE_BUSINESS_SLUG || '',
  // UMI API is the only authority. Browser clients never receive Supabase
  // credentials and authenticate only with API-issued httpOnly cookies.
  apiBase: (import.meta.env.VITE_API_BASE || '').replace(/\/+$/, ''),
  // cashApiBase is empty — cash routes ride the same apiUrl() base as everything else.
  cashApiBase: '',
};

export const LIVE = !!CFG.businessId;
export const CASH_LIVE = !!CFG.businessSlug;

// umi-api backend: auth lives in an httpOnly cookie, requests are cross-origin with credentials.
export const COOKIE_AUTH = true;
export const LOCAL_SESSION = true;

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

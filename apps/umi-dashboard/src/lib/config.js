// Central config — reads from Vite env vars (VITE_ prefix).
// Add values to .env — never commit secrets.

export const CFG = {
  supabaseUrl:     import.meta.env.VITE_SUPABASE_URL     || '',
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY || '',
  businessId:      import.meta.env.VITE_BUSINESS_ID       || '',
  businessSlug:    import.meta.env.VITE_BUSINESS_SLUG     || '',
  // 'supabase' | 'local' (server.js, X-UMI-User-ID header) | 'cookie' (umi-api, httpOnly cookie)
  authMode:        import.meta.env.VITE_AUTH_MODE         || 'supabase',
  // Origin of the API backend. '' = same-origin (Vite proxy / server.js). For the umi-api
  // cutover set VITE_API_BASE=https://api.umiconsulting.co (used by 'cookie' mode).
  apiBase:         (import.meta.env.VITE_API_BASE || '').replace(/\/+$/, ''),
  // cashApiBase is empty — cash routes ride the same apiUrl() base as everything else.
  cashApiBase:     '',
};

export const LIVE = !!(CFG.supabaseUrl && CFG.supabaseAnonKey && CFG.businessId);
export const CASH_LIVE = !!CFG.businessSlug;

// umi-api backend: auth lives in an httpOnly cookie, requests are cross-origin with credentials.
export const COOKIE_AUTH = CFG.authMode === 'cookie';
// Both 'local' and 'cookie' keep the session *display data* (user/tenants) in localStorage.
export const LOCAL_SESSION = CFG.authMode === 'local' || COOKIE_AUTH;

/** Resolve an app-relative API path against the configured backend origin. */
export function apiUrl(path) {
  return CFG.apiBase + path;
}

/** Spread into every fetch() init so cross-origin cookies are sent in 'cookie' mode. */
export function withCreds(init) {
  return COOKIE_AUTH ? Object.assign({ credentials: 'include' }, init) : (init || {});
}

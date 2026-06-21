// Central config — reads from Vite env vars (VITE_ prefix).
// Add values to .env — never commit secrets.

export const CFG = {
  supabaseUrl:     import.meta.env.VITE_SUPABASE_URL     || '',
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY || '',
  businessId:      import.meta.env.VITE_BUSINESS_ID       || '',
  businessSlug:    import.meta.env.VITE_BUSINESS_SLUG     || '',
  authMode:        import.meta.env.VITE_AUTH_MODE         || 'supabase',
  // cashApiBase is empty — Vite proxies /api/* to Express on port 4001
  cashApiBase:     '',
};

export const LIVE = !!(CFG.supabaseUrl && CFG.supabaseAnonKey && CFG.businessId);
export const CASH_LIVE = !!CFG.businessSlug;

// Zero-dependency HTTP route contract shared by umi-api (server) and
// umi-dashboard (client). Keeping the path literals + builders in one place means
// a rename can't silently drift between the two sides. Byte-exact to the NestJS
// controllers (apps/umi-api/src/modules/**). This module imports nothing, so the
// dashboard can consume it without pulling zod into its bundle.

const enc = encodeURIComponent;

/** Base path for a tenant-scoped resource: `/api/tenants/:tenantId`. */
const tenantBase = (tenantId: string): string => `/api/tenants/${enc(tenantId)}`;

export const routes = {
  auth: {
    login: '/api/auth/local/login',
    refresh: '/api/auth/local/refresh',
    logout: '/api/auth/local/logout',
    forgotPassword: '/api/auth/local/forgot-password',
    resetPassword: '/api/auth/local/reset-password',
    me: '/api/auth/me',
  },
  me: {
    tenants: '/api/me/tenants',
  },
  tenants: {
    /** `/api/tenants/:tenantId` — compose sub-paths onto this. Encodes the id,
     *  matching the dashboard's `_tenantPath` (encodeURIComponent). */
    base: tenantBase,
    capabilities: (tenantId: string): string => `${tenantBase(tenantId)}/capabilities`,
    settings: (tenantId: string): string => `${tenantBase(tenantId)}/settings`,
    locations: (tenantId: string): string => `${tenantBase(tenantId)}/locations`,
  },
  cash: {
    // Tenant-scoped surface (dashboard, cookie auth) — /api/tenants/:tenantId/cash/*.
    stats: (tenantId: string): string => `${tenantBase(tenantId)}/cash/stats`,
    analytics: (tenantId: string): string => `${tenantBase(tenantId)}/cash/analytics`,
    customers: (tenantId: string): string => `${tenantBase(tenantId)}/cash/customers`,
    members: (tenantId: string): string => `${tenantBase(tenantId)}/cash/members`,
    giftCards: (tenantId: string): string => `${tenantBase(tenantId)}/cash/gift-cards`,
    rewardConfig: (tenantId: string): string => `${tenantBase(tenantId)}/cash/reward-config`,
    // Slug-scoped surface (umi-cash frontend) — /api/:slug/... . The write + primary
    // read paths both surfaces call; each byte-exact to the cash-scan / cash-write /
    // cash-customer / cash controllers (not an exhaustive mirror of every GET).
    slug: {
      scan: (slug: string): string => `/api/${enc(slug)}/admin/scan`,
      topup: (slug: string): string => `/api/${enc(slug)}/admin/topup`,
      purchase: (slug: string): string => `/api/${enc(slug)}/admin/purchase`,
      giftCards: (slug: string): string => `/api/${enc(slug)}/admin/gift-cards`,
      settings: (slug: string): string => `/api/${enc(slug)}/admin/settings`,
      rewardConfig: (slug: string): string => `/api/${enc(slug)}/admin/reward-config`,
      stats: (slug: string): string => `/api/${enc(slug)}/admin/stats`,
      analytics: (slug: string): string => `/api/${enc(slug)}/admin/analytics`,
      // POST /api/:slug/customers — member registration (name↔path: registers a member).
      registerMember: (slug: string): string => `/api/${enc(slug)}/customers`,
      gift: (slug: string, code: string): string => `/api/${enc(slug)}/gift/${enc(code)}`,
    },
  },
} as const;

export type Routes = typeof routes;

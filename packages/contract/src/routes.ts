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
    stats: (tenantId: string): string => `${tenantBase(tenantId)}/cash/stats`,
  },
} as const;

export type Routes = typeof routes;

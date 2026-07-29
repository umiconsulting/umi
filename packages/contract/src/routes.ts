// Zero-dependency HTTP route accessor shared by umi-api (server), umi-dashboard and
// umi-cash (clients). This module imports nothing but `route-table.ts`, so the
// dashboard can consume it without pulling zod into its bundle.
//
// THERE ARE NO PATH LITERALS HERE. Every path comes from `ROUTE_TABLE` in
// `./route-table.ts`, which is the single author of the platform's URL space. This
// file is the ergonomic view of that table: the shape callers already use, with the
// parameters encoded. To change a path, change the table.
//
// The POS surface is versioned (`/api/v1/...`); the browser surfaces are not. The
// reasoning is in `route-table.ts`.

import { buildPath, routePath, tenantBase } from './route-table';

export { tenantBase };

export const routes = {
  auth: {
    login: routePath('auth.login'),
    refresh: routePath('auth.refresh'),
    logout: routePath('auth.logout'),
    globalLogout: routePath('auth.globalLogout'),
    forgotPassword: routePath('auth.forgotPassword'),
    resetPassword: routePath('auth.resetPassword'),
    me: routePath('auth.me'),
    /** POS device authentication. Versioned — a field client depends on it. */
    pos: {
      login: routePath('auth.posLogin'),
      refresh: routePath('auth.posRefresh'),
      logout: routePath('auth.posLogout'),
      globalLogout: routePath('auth.posGlobalLogout'),
    },
  },
  me: {
    tenants: routePath('me.tenants'),
  },
  tenants: {
    /** `/api/tenants/:tenantId` — compose ad-hoc sub-paths onto this. */
    base: tenantBase,
    capabilities: (tenantId: string): string => buildPath('tenants.capabilities', { tenantId }),
    settings: (tenantId: string): string => buildPath('tenants.settings', { tenantId }),
    locations: (tenantId: string): string => buildPath('tenants.locations', { tenantId }),
    audit: (tenantId: string): string => buildPath('tenants.audit', { tenantId }),
  },
  cash: {
    // Tenant-scoped surface (dashboard, cookie auth).
    stats: (tenantId: string): string => buildPath('cash.stats', { tenantId }),
    analytics: (tenantId: string): string => buildPath('cash.analytics', { tenantId }),
    customers: (tenantId: string): string => buildPath('cash.customers', { tenantId }),
    members: (tenantId: string): string => buildPath('cash.members', { tenantId }),
    giftCards: (tenantId: string): string => buildPath('cash.giftCards', { tenantId }),
    rewardConfig: (tenantId: string): string => buildPath('cash.rewardConfig', { tenantId }),
    // Slug-scoped surface (umi-cash frontend). The write plus primary read paths both
    // surfaces call; not an exhaustive mirror of every GET.
    slug: {
      scan: (slug: string): string => buildPath('cash.slug.scan', { slug }),
      topup: (slug: string): string => buildPath('cash.slug.topup', { slug }),
      purchase: (slug: string): string => buildPath('cash.slug.purchase', { slug }),
      giftCards: (slug: string): string => buildPath('cash.slug.giftCards', { slug }),
      settings: (slug: string): string => buildPath('cash.slug.settings', { slug }),
      rewardConfig: (slug: string): string => buildPath('cash.slug.rewardConfig', { slug }),
      stats: (slug: string): string => buildPath('cash.slug.stats', { slug }),
      analytics: (slug: string): string => buildPath('cash.slug.analytics', { slug }),
      // POST /api/:slug/customers — member registration (name↔path: registers a member).
      registerMember: (slug: string): string => buildPath('cash.slug.registerMember', { slug }),
      gift: (slug: string, code: string): string => buildPath('cash.slug.gift', { slug, code }),
    },
  },
  staff: {
    create: (slug: string): string => buildPath('staff.create', { slug }),
    update: (slug: string, staffId: string): string => buildPath('staff.update', { slug, staffId }),
  },
  devices: {
    beginEnrollment: (tenantId: string): string =>
      buildPath('devices.beginEnrollment', { tenantId }),
    completeEnrollment: routePath('devices.completeEnrollment'),
    status: routePath('devices.status'),
  },
  pos: {
    entryContext: routePath('pos.entryContext'),
    operatorSessions: routePath('pos.operatorSessions'),
    operatorLock: (operatorSessionId: string): string =>
      buildPath('pos.operatorLock', { operatorSessionId }),
    operatorEnd: (operatorSessionId: string): string =>
      buildPath('pos.operatorEnd', { operatorSessionId }),
    verifyPin: routePath('pos.verifyPin'),
    managerApproval: routePath('pos.managerApproval'),
    catalog: {
      categories: (tenantId: string): string => buildPath('pos.catalogCategories', { tenantId }),
      products: (tenantId: string): string => buildPath('pos.catalogProducts', { tenantId }),
      product: (tenantId: string, productId: string): string =>
        buildPath('pos.catalogProduct', { tenantId, productId }),
    },
    cart: {
      base: (tenantId: string): string => buildPath('pos.cartCreate', { tenantId }),
      lines: (tenantId: string): string => buildPath('pos.cartLines', { tenantId }),
      line: (tenantId: string, lineId: string): string =>
        buildPath('pos.cartLineUpdate', { tenantId, lineId }),
      prepare: (tenantId: string): string => buildPath('pos.cartPrepare', { tenantId }),
    },
    checkout: {
      base: (tenantId: string): string => buildPath('pos.checkout', { tenantId }),
      payment: (tenantId: string, paymentId: string): string =>
        buildPath('pos.checkoutPayment', { tenantId, paymentId }),
    },
    offline: {
      policy: (tenantId: string): string => buildPath('pos.offlinePolicy', { tenantId }),
      replayBegin: (tenantId: string): string => buildPath('pos.offlineReplayBegin', { tenantId }),
      replayBatch: (tenantId: string): string => buildPath('pos.offlineReplayBatch', { tenantId }),
      replayCursor: (tenantId: string): string =>
        buildPath('pos.offlineReplayCursor', { tenantId }),
      replayCommand: (tenantId: string, commandId: string): string =>
        buildPath('pos.offlineReplayCommand', { tenantId, commandId }),
      conflicts: (tenantId: string): string => buildPath('pos.offlineConflicts', { tenantId }),
      reconcile: (tenantId: string): string => buildPath('pos.offlineReconcile', { tenantId }),
      reconcileAcknowledge: (tenantId: string): string =>
        buildPath('pos.offlineReconcileAcknowledge', { tenantId }),
      diagnostics: (tenantId: string): string => buildPath('pos.offlineDiagnostics', { tenantId }),
    },
  },
} as const;

export type Routes = typeof routes;

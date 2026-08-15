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

import { buildPath, routePath, merchantBase } from './route-table';

export { merchantBase };

export const routes = {
  auth: {
    login: routePath('auth.login'),
    /** Second half of the two-step login, when `login` answers `mfaRequired`. */
    mfaVerify: routePath('auth.mfaVerify'),
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
    merchants: routePath('me.merchants'),
  },
  merchants: {
    /** `/api/merchants/:merchantId` — compose ad-hoc sub-paths onto this. */
    base: merchantBase,
    capabilities: (merchantId: string): string =>
      buildPath('merchants.capabilities', { merchantId }),
    settings: (merchantId: string): string => buildPath('merchants.settings', { merchantId }),
    locations: (merchantId: string): string => buildPath('merchants.locations', { merchantId }),
    audit: (merchantId: string): string => buildPath('merchants.audit', { merchantId }),
  },
  cash: {
    // Merchant-scoped surface (dashboard, cookie auth).
    stats: (merchantId: string): string => buildPath('cash.stats', { merchantId }),
    analytics: (merchantId: string): string => buildPath('cash.analytics', { merchantId }),
    customers: (merchantId: string): string => buildPath('cash.customers', { merchantId }),
    members: (merchantId: string): string => buildPath('cash.members', { merchantId }),
    giftCards: (merchantId: string): string => buildPath('cash.giftCards', { merchantId }),
    rewardConfig: (merchantId: string): string => buildPath('cash.rewardConfig', { merchantId }),
    // The umi-cash surface, addressed by merchant REFERENCE: an id, or the published
    // handle those URLs were built with. The write plus primary read paths both
    // surfaces call; not an exhaustive mirror of every GET.
    byRef: {
      scan: (ref: string): string => buildPath('cash.byRef.scan', { merchantRef: ref }),
      topup: (ref: string): string => buildPath('cash.byRef.topup', { merchantRef: ref }),
      purchase: (ref: string): string => buildPath('cash.byRef.purchase', { merchantRef: ref }),
      giftCards: (ref: string): string => buildPath('cash.byRef.giftCards', { merchantRef: ref }),
      settings: (ref: string): string => buildPath('cash.byRef.settings', { merchantRef: ref }),
      rewardConfig: (ref: string): string =>
        buildPath('cash.byRef.rewardConfig', { merchantRef: ref }),
      stats: (ref: string): string => buildPath('cash.byRef.stats', { merchantRef: ref }),
      analytics: (ref: string): string => buildPath('cash.byRef.analytics', { merchantRef: ref }),
      // POST /api/:merchantRef/customers — member registration (name↔path: registers a member).
      registerMember: (ref: string): string =>
        buildPath('cash.byRef.registerMember', { merchantRef: ref }),
      gift: (ref: string, code: string): string =>
        buildPath('cash.byRef.gift', { merchantRef: ref, code }),
    },
  },
  staff: {
    create: (ref: string): string => buildPath('staff.create', { merchantRef: ref }),
    update: (ref: string, staffId: string): string =>
      buildPath('staff.update', { merchantRef: ref, staffId }),
  },
  devices: {
    beginEnrollment: (merchantId: string): string =>
      buildPath('devices.beginEnrollment', { merchantId }),
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
      categories: (merchantId: string): string =>
        buildPath('pos.catalogCategories', { merchantId }),
      products: (merchantId: string): string => buildPath('pos.catalogProducts', { merchantId }),
      product: (merchantId: string, productId: string): string =>
        buildPath('pos.catalogProduct', { merchantId, productId }),
    },
    cart: {
      base: (merchantId: string): string => buildPath('pos.cartCreate', { merchantId }),
      lines: (merchantId: string): string => buildPath('pos.cartLines', { merchantId }),
      line: (merchantId: string, lineId: string): string =>
        buildPath('pos.cartLineUpdate', { merchantId, lineId }),
      prepare: (merchantId: string): string => buildPath('pos.cartPrepare', { merchantId }),
    },
    checkout: {
      base: (merchantId: string): string => buildPath('pos.checkout', { merchantId }),
      payment: (merchantId: string, paymentId: string): string =>
        buildPath('pos.checkoutPayment', { merchantId, paymentId }),
    },
    offline: {
      policy: (merchantId: string): string => buildPath('pos.offlinePolicy', { merchantId }),
      replayBegin: (merchantId: string): string =>
        buildPath('pos.offlineReplayBegin', { merchantId }),
      replayBatch: (merchantId: string): string =>
        buildPath('pos.offlineReplayBatch', { merchantId }),
      replayCursor: (merchantId: string): string =>
        buildPath('pos.offlineReplayCursor', { merchantId }),
      replayCommand: (merchantId: string, commandId: string): string =>
        buildPath('pos.offlineReplayCommand', { merchantId, commandId }),
      conflicts: (merchantId: string): string => buildPath('pos.offlineConflicts', { merchantId }),
      reconcile: (merchantId: string): string => buildPath('pos.offlineReconcile', { merchantId }),
      reconcileAcknowledge: (merchantId: string): string =>
        buildPath('pos.offlineReconcileAcknowledge', { merchantId }),
      diagnostics: (merchantId: string): string =>
        buildPath('pos.offlineDiagnostics', { merchantId }),
    },
  },
} as const;

export type Routes = typeof routes;

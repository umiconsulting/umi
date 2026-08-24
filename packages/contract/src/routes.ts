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
      pinLogin: routePath('auth.posPinLogin'),
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
    /** `POST` — open a café. Platform administrators only. */
    provision: routePath('merchants.provision'),
    capabilities: (merchantId: string): string =>
      buildPath('merchants.capabilities', { merchantId }),
    settings: (merchantId: string): string => buildPath('merchants.settings', { merchantId }),
    locations: (merchantId: string): string => buildPath('merchants.locations', { merchantId }),
    audit: (merchantId: string): string => buildPath('merchants.audit', { merchantId }),
    operations: (merchantId: string): string => buildPath('merchants.operations', { merchantId }),
    administrativeCommands: (merchantId: string): string =>
      buildPath('merchants.administrativeCommands', { merchantId }),
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
      scanSeals: (ref: string): string => buildPath('cash.byRef.scanSeals', { merchantRef: ref }),
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
    /** Merchant-scoped, by id — what the dashboard calls. */
    list: (merchantId: string): string => buildPath('staff.list', { merchantId }),
    create: (merchantId: string): string => buildPath('staff.create', { merchantId }),
    update: (merchantId: string, staffId: string): string =>
      buildPath('staff.update', { merchantId, staffId }),
    remove: (merchantId: string, staffId: string): string =>
      buildPath('staff.remove', { merchantId, staffId }),
    /** Reference-addressed — what the register calls. */
    byRef: {
      create: (ref: string): string => buildPath('staff.byRef.create', { merchantRef: ref }),
      update: (ref: string, staffId: string): string =>
        buildPath('staff.byRef.update', { merchantRef: ref, staffId }),
    },
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
      recovery: (merchantId: string, cartId: string): string =>
        buildPath('pos.checkoutRecovery', { merchantId, cartId }),
      cancel: (merchantId: string, cartId: string): string =>
        buildPath('pos.checkoutCancel', { merchantId, cartId }),
    },
    cash: {
      center: (merchantId: string): string => buildPath('pos.cashCenter', { merchantId }),
      command: (merchantId: string, commandId: string): string =>
        buildPath('pos.cashCommand', { merchantId, commandId }),
      shifts: (merchantId: string): string => buildPath('pos.cashShifts', { merchantId }),
      movement: (merchantId: string, shiftId: string): string =>
        buildPath('pos.cashMovement', { merchantId, shiftId }),
      suspend: (merchantId: string, shiftId: string): string =>
        buildPath('pos.cashSuspend', { merchantId, shiftId }),
      resume: (merchantId: string, shiftId: string): string =>
        buildPath('pos.cashResume', { merchantId, shiftId }),
      handoff: (merchantId: string, shiftId: string): string =>
        buildPath('pos.cashHandoff', { merchantId, shiftId }),
      count: (merchantId: string, shiftId: string): string =>
        buildPath('pos.cashCount', { merchantId, shiftId }),
      recount: (merchantId: string, shiftId: string): string =>
        buildPath('pos.cashRecount', { merchantId, shiftId }),
      variance: (merchantId: string, shiftId: string): string =>
        buildPath('pos.cashVariance', { merchantId, shiftId }),
      reconcile: (merchantId: string, shiftId: string): string =>
        buildPath('pos.cashReconcile', { merchantId, shiftId }),
      close: (merchantId: string, shiftId: string): string =>
        buildPath('pos.cashClose', { merchantId, shiftId }),
      noSale: (merchantId: string, shiftId: string): string =>
        buildPath('pos.cashNoSale', { merchantId, shiftId }),
    },
    exceptions: {
      eligibility: (merchantId: string, saleId: string): string =>
        buildPath('pos.exceptionEligibility', { merchantId, saleId }),
      preview: (merchantId: string, saleId: string): string =>
        buildPath('pos.exceptionPreview', { merchantId, saleId }),
      approval: (merchantId: string, saleId: string): string =>
        buildPath('pos.exceptionApproval', { merchantId, saleId }),
      commit: (merchantId: string, saleId: string): string =>
        buildPath('pos.exceptionCommit', { merchantId, saleId }),
      history: (merchantId: string, saleId: string): string =>
        buildPath('pos.exceptionHistory', { merchantId, saleId }),
      result: (merchantId: string, saleId: string, exceptionId: string): string =>
        buildPath('pos.exceptionResult', { merchantId, saleId, exceptionId }),
      terminalOutcome: (merchantId: string, saleId: string, previewId: string): string =>
        buildPath('pos.exceptionTerminalOutcome', { merchantId, saleId, previewId }),
      command: (merchantId: string, commandId: string): string =>
        buildPath('pos.exceptionCommand', { merchantId, commandId }),
    },
    sales: {
      create: (merchantId: string): string => buildPath('pos.salesCreate', { merchantId }),
      current: (merchantId: string): string => buildPath('pos.salesCurrent', { merchantId }),
      list: (merchantId: string): string => buildPath('pos.salesList', { merchantId }),
      suspend: (merchantId: string, saleId: string): string =>
        buildPath('pos.saleSuspend', { merchantId, saleId }),
      resume: (merchantId: string, saleId: string): string =>
        buildPath('pos.saleResume', { merchantId, saleId }),
      rename: (merchantId: string, saleId: string): string =>
        buildPath('pos.saleRename', { merchantId, saleId }),
      cancel: (merchantId: string, saleId: string): string =>
        buildPath('pos.saleCancel', { merchantId, saleId }),
      attachCustomer: (merchantId: string, saleId: string): string =>
        buildPath('pos.saleCustomerAttach', { merchantId, saleId }),
      detachCustomer: (merchantId: string, saleId: string): string =>
        buildPath('pos.saleCustomerDetach', { merchantId, saleId }),
      receipt: (merchantId: string, saleId: string): string =>
        buildPath('pos.saleReceipt', { merchantId, saleId }),
      customers: (merchantId: string): string => buildPath('pos.saleCustomers', { merchantId }),
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
    kitchen: {
      order: (merchantId: string, sourceOrderId: string): string =>
        buildPath('pos.kitchenOrder', { merchantId, sourceOrderId }),
    },
  },
  kds: {
    board: routePath('kds.board'),
    command: routePath('kds.command'),
  },
} as const;

export type Routes = typeof routes;

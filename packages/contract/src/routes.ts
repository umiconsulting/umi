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
    posLogin: '/api/auth/pos/login',
    posPinLogin: '/api/auth/pos/pin-login',
    posRefresh: '/api/auth/pos/refresh',
    posLogout: '/api/auth/pos/logout',
  },
  devices: {
    claimPairing: '/api/devices/pairing/claim',
    pollPairing: (pairingSessionId: string): string =>
      `/api/devices/pairing/${enc(pairingSessionId)}/poll`,
    acknowledgePairing: (pairingSessionId: string): string =>
      `/api/devices/pairing/${enc(pairingSessionId)}/acknowledge`,
    status: '/api/devices/status',
    beginEnrollment: (tenantId: string): string => `${tenantBase(tenantId)}/devices/enrollment`,
    enrollmentRequests: (tenantId: string): string =>
      `${tenantBase(tenantId)}/devices/enrollment-requests`,
    approveEnrollment: (tenantId: string, requestId: string): string =>
      `${tenantBase(tenantId)}/devices/enrollment-requests/${enc(requestId)}/approve`,
    denyEnrollment: (tenantId: string, requestId: string): string =>
      `${tenantBase(tenantId)}/devices/enrollment-requests/${enc(requestId)}/deny`,
    rotate: (tenantId: string, deviceId: string): string =>
      `${tenantBase(tenantId)}/devices/${enc(deviceId)}/rotate`,
    revoke: (tenantId: string, deviceId: string): string =>
      `${tenantBase(tenantId)}/devices/${enc(deviceId)}/revoke`,
    replace: (tenantId: string): string => `${tenantBase(tenantId)}/devices/replacement`,
  },
  pos: {
    entryContext: '/api/pos/entry-context',
    operatorSession: '/api/pos/operator-sessions',
    operatorLock: (sessionId: string): string =>
      `/api/pos/operator-sessions/${enc(sessionId)}/lock`,
    operatorEnd: (sessionId: string): string => `/api/pos/operator-sessions/${enc(sessionId)}/end`,
    verifyPin: '/api/pos/elevation/pin',
    managerApproval: '/api/pos/elevation/manager-approval',
    catalogCategories: (tenantId: string): string =>
      `/api/pos/tenants/${enc(tenantId)}/catalog/categories`,
    catalogProducts: (tenantId: string): string =>
      `/api/pos/tenants/${enc(tenantId)}/catalog/products`,
    catalogProduct: (tenantId: string, productId: string): string =>
      `/api/pos/tenants/${enc(tenantId)}/catalog/products/${enc(productId)}`,
    cart: (tenantId: string): string => `/api/pos/tenants/${enc(tenantId)}/cart`,
    cartLines: (tenantId: string): string => `/api/pos/tenants/${enc(tenantId)}/cart/lines`,
    cartLine: (tenantId: string, lineId: string): string =>
      `/api/pos/tenants/${enc(tenantId)}/cart/lines/${enc(lineId)}`,
    clearCart: (tenantId: string): string => `/api/pos/tenants/${enc(tenantId)}/cart/clear`,
    prepareCart: (tenantId: string): string => `/api/pos/tenants/${enc(tenantId)}/cart/prepare`,
    checkout: (tenantId: string): string => `/api/pos/tenants/${enc(tenantId)}/checkout`,
    checkoutPayment: (tenantId: string, paymentId: string): string =>
      `/api/pos/tenants/${enc(tenantId)}/checkout/payments/${enc(paymentId)}`,
    checkoutRecovery: (tenantId: string, cartId: string): string =>
      `/api/pos/tenants/${enc(tenantId)}/checkout/carts/${enc(cartId)}`,
    checkoutCancel: (tenantId: string, cartId: string): string =>
      `/api/pos/tenants/${enc(tenantId)}/checkout/carts/${enc(cartId)}/cancel`,
    cashCenter: (tenantId: string): string => `/api/pos/tenants/${enc(tenantId)}/cash`,
    cashCommand: (tenantId: string, commandId: string): string =>
      `/api/pos/tenants/${enc(tenantId)}/cash/commands/${enc(commandId)}`,
    cashRegisters: (tenantId: string): string => `/api/pos/tenants/${enc(tenantId)}/cash/registers`,
    cashShifts: (tenantId: string): string => `/api/pos/tenants/${enc(tenantId)}/cash/shifts`,
    cashShift: (tenantId: string, shiftId: string): string =>
      `/api/pos/tenants/${enc(tenantId)}/cash/shifts/${enc(shiftId)}`,
    cashMovement: (tenantId: string, shiftId: string): string =>
      `/api/pos/tenants/${enc(tenantId)}/cash/shifts/${enc(shiftId)}/movements`,
    cashSuspend: (tenantId: string, shiftId: string): string =>
      `/api/pos/tenants/${enc(tenantId)}/cash/shifts/${enc(shiftId)}/suspend`,
    cashResume: (tenantId: string, shiftId: string): string =>
      `/api/pos/tenants/${enc(tenantId)}/cash/shifts/${enc(shiftId)}/resume`,
    cashHandoff: (tenantId: string, shiftId: string): string =>
      `/api/pos/tenants/${enc(tenantId)}/cash/shifts/${enc(shiftId)}/handoff`,
    cashCount: (tenantId: string, shiftId: string): string =>
      `/api/pos/tenants/${enc(tenantId)}/cash/shifts/${enc(shiftId)}/counts`,
    cashRecount: (tenantId: string, shiftId: string): string =>
      `/api/pos/tenants/${enc(tenantId)}/cash/shifts/${enc(shiftId)}/counts/recount`,
    cashVariance: (tenantId: string, shiftId: string): string =>
      `/api/pos/tenants/${enc(tenantId)}/cash/shifts/${enc(shiftId)}/variance`,
    cashReconcile: (tenantId: string, shiftId: string): string =>
      `/api/pos/tenants/${enc(tenantId)}/cash/shifts/${enc(shiftId)}/reconcile`,
    cashClose: (tenantId: string, shiftId: string): string =>
      `/api/pos/tenants/${enc(tenantId)}/cash/shifts/${enc(shiftId)}/close`,
    cashNoSale: (tenantId: string, shiftId: string): string =>
      `/api/pos/tenants/${enc(tenantId)}/cash/shifts/${enc(shiftId)}/no-sale`,
    sales: (tenantId: string): string => `/api/pos/tenants/${enc(tenantId)}/sales`,
    currentSale: (tenantId: string): string => `/api/pos/tenants/${enc(tenantId)}/sales/current`,
    saleSuspend: (tenantId: string, saleId: string): string =>
      `/api/pos/tenants/${enc(tenantId)}/sales/${enc(saleId)}/suspend`,
    saleResume: (tenantId: string, saleId: string): string =>
      `/api/pos/tenants/${enc(tenantId)}/sales/${enc(saleId)}/resume`,
    saleRename: (tenantId: string, saleId: string): string =>
      `/api/pos/tenants/${enc(tenantId)}/sales/${enc(saleId)}/rename`,
    saleCancel: (tenantId: string, saleId: string): string =>
      `/api/pos/tenants/${enc(tenantId)}/sales/${enc(saleId)}/cancel`,
    saleCustomer: (tenantId: string, saleId: string): string =>
      `/api/pos/tenants/${enc(tenantId)}/sales/${enc(saleId)}/customer`,
    saleReceipt: (tenantId: string, saleId: string): string =>
      `/api/pos/tenants/${enc(tenantId)}/sales/${enc(saleId)}/receipt`,
    saleCustomers: (tenantId: string): string =>
      `/api/pos/tenants/${enc(tenantId)}/sales/customers`,
    offlineReplayBegin: (tenantId: string): string =>
      `/api/pos/tenants/${enc(tenantId)}/offline/replay/begin`,
    offlinePolicy: (tenantId: string): string => `/api/pos/tenants/${enc(tenantId)}/offline/policy`,
    offlineReplayBatch: (tenantId: string): string =>
      `/api/pos/tenants/${enc(tenantId)}/offline/replay/batch`,
    offlineReplayCursor: (tenantId: string): string =>
      `/api/pos/tenants/${enc(tenantId)}/offline/replay/cursor`,
    offlineReplayCommand: (tenantId: string, commandId: string): string =>
      `/api/pos/tenants/${enc(tenantId)}/offline/replay/commands/${enc(commandId)}`,
    offlineConflicts: (tenantId: string): string =>
      `/api/pos/tenants/${enc(tenantId)}/offline/conflicts`,
    offlineReconcile: (tenantId: string): string =>
      `/api/pos/tenants/${enc(tenantId)}/offline/reconcile`,
    offlineReconcileAcknowledge: (tenantId: string): string =>
      `/api/pos/tenants/${enc(tenantId)}/offline/reconcile/acknowledge`,
    offlineDiagnostics: (tenantId: string): string =>
      `/api/pos/tenants/${enc(tenantId)}/offline/diagnostics`,
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
    audit: (tenantId: string): string => `${tenantBase(tenantId)}/audit`,
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

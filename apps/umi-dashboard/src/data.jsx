import { buildPath } from '@umi/contract/route-table';
import { t } from '@lingui/core/macro';
import {
  useState as useStateD,
  useEffect as useEffectD,
  useMemo as useMemoD,
  useRef as useRefD,
} from 'react';
import { LIVE as _LIVE, COOKIE_AUTH, apiUrl, withCreds, errMessage } from '@/lib/config.js';
import {
  getAuthHeaders,
  refreshSession,
  handleSessionExpired,
  REFRESH_OK,
  REFRESH_DEAD,
} from '@/lib/auth.jsx';
import { useMerchant } from '@/lib/merchant-context.jsx';
import { MODULES, hasRequiredPermission, isProductActive } from '@/lib/module-registry.js';
import { routes } from '@umi/contract/routes';
import { useInfiniteQuery } from '@tanstack/react-query';
import { subscribeConversationMessages } from '@/lib/conversation-realtime.js';

const EMPTY_OVERVIEW = {};
const EMPTY_STATIONS = [];
const EMPTY_TICKER = [];
const EMPTY_DEVICES = [];
const EMPTY_STATIONS_KDS = [];
const EMPTY_PAIRINGS = [];
const EMPTY_MERCHANT = null;
const EMPTY_ORDERS = [];
const EMPTY_MEMBERS = { customers: [], total: 0, page: 1, totalPages: 1 };
const EMPTY_CUSTOMER_DETAIL = {
  customer: null,
  kpis: null,
  timeline: [],
  conversations: [],
  orders: [],
  cash: null,
  identity: null,
};
const EMPTY_CUSTOMER_DESCRIPTION = { description: null, generated: false, segment: null };
const EMPTY_SALES_INSIGHT = { narrative: null, generated: false, capturedAt: null };
const EMPTY_CUSTOMER_INSIGHTS = { metrics: {}, insights: [], source: null };
const EMPTY_STAFF = { staff: [] };
const EMPTY_ROLES = { roles: [], permissions: [] };
const EMPTY_HOURS = {
  hours: {},
  timezone: null,
  ordering: { acceptsOrders: true, orderCutoffMinutes: 30, specialNotice: null, bypassPhones: [] },
};
const EMPTY_VOICE = { voice: null, presets: [], businessName: '', defaults: null };
const EMPTY_GIFT_CARDS = { giftCards: [], total: 0, page: 1, totalPages: 1 };
const EMPTY_CONVERSATIONS = { conversations: [], total: 0, page: 1, totalPages: 1 };
const EMPTY_OPERATIONS = {
  domains: [],
  items: [],
  page: { limit: 20, hasMore: false, nextCursor: null },
};
const DEVICE_LIVE_MS = 10_000;
const DEVICE_OFFLINE_MS = 20_000;

function _merchantId(ctx) {
  return ctx?.selectedMerchantId || ctx?.capabilities?.merchant?.id;
}

function _locationId(ctx) {
  return ctx?.selectedLocationId || ctx?.capabilities?.selectedLocation?.id || '';
}

function _active(ctx, productKey) {
  return isProductActive(productKey, ctx?.capabilities);
}

/**
 * May this operator read the café's cash admin surface (`/api/{ref}/admin/settings`)?
 *
 * That route is the SETTINGS module's surface, and both its halves are gated on
 * `merchant.manage` (`apps/umi-api/src/modules/cash/cash.controller.ts`) — the
 * registry says the same thing, so the question is asked of the registry rather
 * than re-typed here. A café product and a permission is all it takes.
 *
 * The shell mounts `_loadMerchant` on EVERY screen, so an un-gated call was one
 * 403 per screen load for a cashier. The `.catch` kept it invisible, which is
 * exactly why it survived: silent noise, and the café's branding never resolved
 * from that path. `_loadMerchant` now skips the call and keeps its existing
 * fallbacks (`cashSettings?.x || s.x`).
 */
function _canReadCashSettings(ctx) {
  return _active(ctx, 'cash') && hasRequiredPermission(MODULES.settings, ctx?.capabilities);
}

function _withLocation(ctx, path) {
  const locationId = _locationId(ctx);
  if (!locationId) return path;
  const sep = path.includes('?') ? '&' : '?';
  return `${path}${sep}locationId=${encodeURIComponent(locationId)}`;
}

async function _apiFetch(path, opts, _retried) {
  opts = opts || {};
  const authHeaders = await getAuthHeaders();
  // Only advertise a JSON body when we actually send one. Fastify rejects an
  // empty body when Content-Type is application/json, so bodyless mutations
  // (pairing approve/deny, deletes) must NOT carry the header.
  const headers = Object.assign({}, authHeaders);
  if (COOKIE_AUTH && opts.method && !['GET', 'HEAD', 'OPTIONS'].includes(opts.method)) {
    const csrf = document.cookie
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith('umi_csrf='));
    if (csrf) headers['X-UMI-CSRF'] = decodeURIComponent(csrf.slice('umi_csrf='.length));
  }
  if (opts.body != null) headers['Content-Type'] = 'application/json';
  const res = await fetch(
    apiUrl(path),
    withCreds(
      Object.assign({}, opts, {
        headers: Object.assign(headers, opts.headers || {}),
      }),
    ),
  );

  // Cookie-mode session recovery: a 401 means the short-lived access cookie
  // expired. Refresh once (single-flight) and retry the request.
  //
  // ⚠️ Only a DEAD refresh may sign the operator out. A transient one (429 from
  // the rate limiter, a 5xx, a dropped connection) leaves the refresh cookie
  // valid, so the session — and localStorage — must survive it; bouncing to
  // /login here is what logged operators out on a hiccup. The failed screen keeps
  // its own error state, and the shell's connection indicator already reports the
  // API as unreachable.
  if (res.status === 401 && COOKIE_AUTH && !_retried && !path.includes('/api/auth/')) {
    const outcome = await refreshSession();
    if (outcome === REFRESH_OK) return _apiFetch(path, opts, true);
    if (outcome === REFRESH_DEAD) {
      handleSessionExpired();
      const dead = new Error(t`Sesión expirada`);
      dead.status = 401;
      dead.code = 'session_expired';
      dead.path = path;
      throw dead;
    }
    // Transient: the API is unreachable or rate-limiting us, not refusing us.
    // Report the degraded state and leave the session alone — auth.jsx has armed
    // a bounded retry, and the next successful refresh retries this request.
    const deferred = new Error(t`El servicio no está disponible. Intenta de nuevo después.`);
    deferred.status = 503;
    deferred.code = 'session_refresh_deferred';
    deferred.path = path;
    throw deferred;
  }

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Keep the human string on .message, but also surface the machine code and
    // HTTP status so callers can map to friendly copy and log the raw detail.
    const err = new Error(errMessage(payload, `${res.status} ${path}`));
    err.status = res.status;
    // ⚠️ THE CODE CAN BE NESTED, and it has TWO SPELLINGS. The umi-api filter wraps
    // a thrown payload as `{ statusCode, error: <payload> }`, so a route that throws
    // `{ error: 'email_taken', message }` arrives as `payload.error.error`, and the
    // POS/operations routes throw `{ code: 'PIN_INVALID' }`, which arrives as
    // `payload.error.code`. Reading only the top level left every structured
    // umi-api refusal with a null code, and the caller with nothing to branch on.
    // `code` is tried first because it is the more specific of the two.
    err.code =
      (payload && typeof payload.code === 'string' && payload.code) ||
      (payload && payload.error && typeof payload.error.code === 'string'
        ? payload.error.code
        : null) ||
      (payload && typeof payload.error === 'string' && payload.error) ||
      (payload && payload.error && typeof payload.error.error === 'string'
        ? payload.error.error
        : null);
    err.path = path;
    err.details = payload;
    throw err;
  }
  return payload;
}

function _merchantPath(ctx, suffix) {
  const merchantId = _merchantId(ctx);
  if (!merchantId) throw new Error(t`No hay un negocio seleccionado`);
  return `${routes.merchants.base(merchantId)}${suffix}`;
}

function _useAsync(asyncFn, deps, seed) {
  const [state, setState] = useStateD({
    data: seed,
    loading: true,
    error: null,
    errorCode: null,
    loaded: false,
  });
  useEffectD(function () {
    var active = true;
    setState(function (s) {
      return Object.assign({}, s, { loading: true, error: null, errorCode: null });
    });
    Promise.resolve()
      .then(function () {
        return asyncFn();
      })
      .then(function (data) {
        if (active)
          setState({ data: data, loading: false, error: null, errorCode: null, loaded: true });
      })
      .catch(function (err) {
        if (active)
          setState(function (s) {
            return Object.assign({}, s, {
              data: seed,
              loading: false,
              error: err.message,
              errorCode: err.code || null,
            });
          });
      });
    return function () {
      active = false;
    };
  }, deps);
  return state;
}

function _deps(ctx, extra) {
  const products = ctx?.capabilities?.products || {};
  return [
    _merchantId(ctx) || '',
    _locationId(ctx) || '',
    products.cash?.status || '',
    products.kds?.status || '',
    products.conversaflow?.status || '',
    // `_loadMerchant` branches on one permission before it will call the cash
    // admin surface. A loader's deps carry everything it branches on — the same
    // rule the product statuses above follow — or it can answer from a stale
    // read: the first pass runs before the capabilities resolve, when the
    // permission list is still empty.
    _canReadCashSettings(ctx) ? 'cash-settings' : '',
    ...(extra || []),
  ];
}

function _deviceStatus(lastUsedAt) {
  if (!lastUsedAt) return 'offline';
  var ms = Date.now() - new Date(lastUsedAt).getTime();
  if (ms < DEVICE_LIVE_MS) return 'live';
  if (ms < DEVICE_OFFLINE_MS) return 'slow';
  return 'offline';
}

function _fmtLastSeen(lastUsedAt) {
  if (!lastUsedAt) return t`nunca`;
  var ms = Date.now() - new Date(lastUsedAt).getTime();
  if (ms < 10000) return t`hace un momento`;
  if (ms < 60000) return t`hace ${Math.floor(ms / 1000)} s`;
  if (ms < 3600000) return t`hace ${Math.floor(ms / 60000)} min`;
  return t`hace ${Math.floor(ms / 3600000)} h`;
}

async function _loadOverviewAndStations(ctx) {
  const cashResults = _active(ctx, 'cash')
    ? await Promise.allSettled([
        _apiFetch(_merchantPath(ctx, '/cash/stats')),
        _apiFetch(_merchantPath(ctx, '/cash/analytics')),
        _apiFetch(_merchantPath(ctx, '/cash/gift-cards?limit=100')),
      ])
    : [];
  const kdsResults = _active(ctx, 'kds')
    ? await Promise.allSettled([
        _apiFetch(_withLocation(ctx, _merchantPath(ctx, '/kds/orders?filter=all'))),
        _apiFetch(_withLocation(ctx, _merchantPath(ctx, '/kds/devices'))),
        _apiFetch(_withLocation(ctx, _merchantPath(ctx, '/kds/ticker'))),
      ])
    : [];

  const stats = cashResults[0]?.status === 'fulfilled' ? cashResults[0].value : null;
  const analytics = cashResults[1]?.status === 'fulfilled' ? cashResults[1].value : null;
  const giftCards =
    cashResults[2]?.status === 'fulfilled' ? cashResults[2].value.giftCards || [] : [];
  const orderPayload = kdsResults[0]?.status === 'fulfilled' ? kdsResults[0].value : null;
  const devicePayload = kdsResults[1]?.status === 'fulfilled' ? kdsResults[1].value : null;
  const tickerPayload = kdsResults[2]?.status === 'fulfilled' ? kdsResults[2].value : null;

  const orders = orderPayload?.orders || [];
  const devices = devicePayload?.devices || [];
  const activeOrders = orders.filter(function (t) {
    return ['new', 'accepted', 'preparing', 'ready'].indexOf(t.status) !== -1;
  });
  const completedOrders = orders.filter(function (t) {
    return t.status === 'completed';
  });
  const cancelledOrders = orders.filter(function (t) {
    return t.status === 'cancelled';
  });
  const totalAmount = orders.reduce(function (sum, t) {
    return sum + (parseFloat(t.total_amount) || 0);
  }, 0);

  const byStation = {};
  activeOrders.forEach(function (t) {
    const sid = t.station_id || 'unassigned';
    if (!byStation[sid]) byStation[sid] = { name: t.station_name || 'Unassigned', count: 0 };
    byStation[sid].count++;
  });
  const devByStation = {};
  devices.forEach(function (d) {
    devByStation[d.station_id || 'unassigned'] = d.last_used_at;
  });

  const stations = Object.keys(byStation).map(function (sid) {
    const lastAt = devByStation[sid] || null;
    return {
      station_id: sid,
      station_name: byStation[sid].name,
      label: sid.toUpperCase(),
      status: _deviceStatus(lastAt),
      open: byStation[sid].count,
      foot: _fmtLastSeen(lastAt),
    };
  });

  const openGiftCards = giftCards.filter(function (card) {
    return !card.isRedeemed;
  });

  return {
    overview: {
      activeMembers: analytics?.totalCustomers ?? null,
      memberDeltaPct: analytics?.memberDeltaPct ?? null,
      memberHistory: analytics?.memberHistory ?? [],
      newThisWeek: analytics?.newThisWeek ?? null,
      birthdayActivatable: analytics?.birthdayActivatable ?? null,
      highBalanceCount: analytics?.highBalanceCount ?? null,
      visitsToday: stats?.visitsToday ?? null,
      visitsDeltaPct: analytics?.visitsDeltaPct ?? null,
      openGiftCards: openGiftCards.length,
      openGiftCardsDelta: null,
      rewardsRedeemed7d: analytics?.rewardsRedeemedThisMonth ?? null,
      rewardsDelta7d: null,
      revenueThisMonth: analytics?.topupsThisMonth ?? null,
      revenueDeltaPct: null,
      ordersToday: orders.length,
      ordersAccepted: completedOrders.length + activeOrders.length,
      ordersCancelled: cancelledOrders.length,
      avgTicketMXN: orders.length ? Math.round(totalAmount / orders.length) : null,
      walletProcessedToday: analytics?.topupsThisMonth ?? null,
      topupsTodayMXN: stats?.topupsTodayMXN ?? null,
      topupsTodayCount: stats?.topupsTodayCount ?? null,
      redemptionsTodayMXN: null,
      redemptionsTodayCount: null,
      retentionRate: analytics?.retentionRate ?? null,
      avgVisitsPerCustomer: analytics?.avgVisitsPerCustomer ?? null,
    },
    stations,
    ticker: tickerPayload?.events || [],
  };
}

async function _loadDevices(ctx) {
  if (!_active(ctx, 'kds')) return EMPTY_DEVICES;
  // Heartbeat is now folded into GET /kds/devices server-side: umi-api derives
  // live/slow/offline from device.sessions.last_used_at, which the iPad's board
  // poll touches every cycle (Phase 4). The old separate `/api/kds/heartbeats`
  // call was a same-origin fetch that never reached umi-api in cookie mode — it
  // is removed (the "remove the duplicate" deliverable).
  const devResult = await _apiFetch(_withLocation(ctx, _merchantPath(ctx, '/kds/devices')));
  return (devResult.devices || []).map(function (d) {
    // `d.ip` overrides the merged default, so re-apply the '-' fallback after
    // the spread (the server sends null when no ip has been recorded yet).
    return Object.assign(
      { model: 'iPad' },
      d,
      { ip: d.ip || '-' },
      d.status
        ? {
            _heartbeatStatus: d.status, // 'live' | 'slow' | 'offline'
            _heartbeatSeenMs: d.last_used_at ? new Date(d.last_used_at).getTime() : null,
          }
        : {},
    );
  });
}

async function _loadKdsStations(ctx) {
  if (!_active(ctx, 'kds')) return EMPTY_STATIONS_KDS;
  const result = await _apiFetch(_withLocation(ctx, _merchantPath(ctx, '/kds/stations')));
  return result.stations || [];
}

async function _loadDevicePairings(ctx) {
  if (!_active(ctx, 'kds')) return EMPTY_PAIRINGS;
  const result = await _apiFetch(_withLocation(ctx, _merchantPath(ctx, '/kds/devices/pairing')));
  return result.pairings || [];
}

async function _loadMerchant(ctx) {
  const s = await _apiFetch(_merchantPath(ctx, '/settings'));
  // Reach the cash admin surface by merchant ID, not by the published handle. The two
  // used to be the same string; they are not, and a café created after cutover has no
  // handle at all. The route accepts either, and the id is the one that always exists.
  // Permission-gated on the server (`merchant.manage`); a role that cannot read it
  // does not ask, and falls through to the merchant record below.
  const cashSettings = _canReadCashSettings(ctx)
    ? await _apiFetch(`/api/${encodeURIComponent(_merchantId(ctx))}/admin/settings`).catch(
        () => null,
      )
    : null;
  const rc = _active(ctx, 'cash')
    ? await _apiFetch(_merchantPath(ctx, '/cash/reward-config')).catch(() => null)
    : null;
  if (!s) return null;
  return {
    name: cashSettings?.name || s.name,
    city: cashSettings?.city || s.city,
    handle: cashSettings?.handle || s.handle || null,
    cardPrefix: cashSettings?.cardPrefix || s.cardPrefix || '',
    primaryColor: cashSettings?.primaryColor || s.primaryColor || '#B5605A',
    secondaryColor: cashSettings?.secondaryColor || s.secondaryColor || '#E8C9A3',
    logoUrl: cashSettings?.logoUrl || s.logoUrl || '',
    stripImageUrl: cashSettings?.stripImageUrl || s.stripImageUrl || '',
    passStyle: cashSettings?.passStyle || s.passStyle || 'stamps',
    subscriptionStatus: s.subscriptionStatus || 'ACTIVE',
    businessDayStart: s.businessDayStart || '00:00',
    // Effective segment cutoffs (code defaults merged with the owner's overrides).
    segmentThresholds: s.segmentThresholds || {},
    topupEnabled: s.topupEnabled,
    selfRegistration: cashSettings?.selfRegistration ?? s.selfRegistration,
    birthdayRewardEnabled: cashSettings?.birthdayRewardEnabled ?? s.birthdayRewardEnabled,
    birthdayRewardName: cashSettings?.birthdayRewardName ?? s.birthdayRewardName,
    promoMessage: cashSettings?.promoMessage || s.promoMessage || '',
    promoStartsAt:
      cashSettings?.promoStartsAt || s.promoStartsAt
        ? (cashSettings?.promoStartsAt || s.promoStartsAt).slice(0, 10)
        : '',
    promoEndsAt:
      cashSettings?.promoEndsAt || s.promoEndsAt
        ? (cashSettings?.promoEndsAt || s.promoEndsAt).slice(0, 10)
        : '',
    promoDays: cashSettings?.promoDays || s.promoDays || '',
    products: s.products || ctx?.capabilities?.products || {},
    locations: s.locations || ctx?.capabilities?.locations || [],
    rewardConfig: rc?.active
      ? {
          visitsRequired: rc.active.visitsRequired,
          rewardName: rc.active.rewardName,
          rewardCostCentavos: rc.active.rewardCostCentavos ?? 0,
          isActive: rc.active.isActive !== false,
        }
      : null,
  };
}

async function _loadOrders(ctx, filter, channel) {
  if (!_active(ctx, 'dashboard')) return EMPTY_ORDERS;
  const query = new URLSearchParams({ filter: filter || 'all' });
  if (channel) query.set('channel', channel);
  const result = await _apiFetch(
    _withLocation(ctx, _merchantPath(ctx, '/orders?' + query.toString())),
  );
  return (result.orders || []).map(function (t) {
    return Object.assign({ items_count: 0, items: [] }, t);
  });
}

async function _loadMembers(ctx, opts) {
  if (!_active(ctx, 'cash')) return EMPTY_MEMBERS;
  opts = opts || {};
  const q = new URLSearchParams({
    page: String(opts.page || 1),
    limit: String(opts.limit || 20),
    sort: opts.sort || 'recent',
  });
  if (opts.search) q.set('search', opts.search);
  return _apiFetch(_merchantPath(ctx, '/cash/customers?' + q));
}

async function _loadCustomers(ctx, opts) {
  opts = opts || {};
  const q = new URLSearchParams({ limit: String(opts.limit || 20) });
  if (opts.cursor) q.set('cursor', String(opts.cursor));
  if (opts.search) q.set('search', opts.search);
  if (opts.filter) q.set('filter', opts.filter);
  return _apiFetch(_merchantPath(ctx, '/customers?' + q));
}

async function _loadCustomerDetail(ctx, customerId) {
  if (!customerId) return EMPTY_CUSTOMER_DETAIL;
  return _apiFetch(_merchantPath(ctx, '/customers/' + encodeURIComponent(customerId)));
}

// One page of a conversation's transcript. `cursor` (opaque) walks OLDER; a null
// cursor loads the newest page. Returns { messages: oldest-first, nextCursor }.
async function _loadConversationMessages(ctx, customerId, conversationId, cursor) {
  if (!customerId || !conversationId) return { messages: [], nextCursor: null };
  const q = new URLSearchParams({ limit: '30' });
  if (cursor) q.set('cursor', String(cursor));
  return _apiFetch(
    _merchantPath(
      ctx,
      '/customers/' +
        encodeURIComponent(customerId) +
        '/conversations/' +
        encodeURIComponent(conversationId) +
        '/messages?' +
        q,
    ),
  );
}

async function _loadCustomerInsights(ctx) {
  return _apiFetch(_merchantPath(ctx, '/insights/customer-platform'));
}

// The AI customer portrait for the Overview tab. Loaded separately from the detail
// bundle so the (slow) model call never blocks the KPI tiles.
async function _loadCustomerDescription(ctx, customerId) {
  if (!customerId) return EMPTY_CUSTOMER_DESCRIPTION;
  return _apiFetch(
    _merchantPath(ctx, '/customers/' + encodeURIComponent(customerId) + '/description'),
  );
}

async function _loadStaff(ctx) {
  const merchantId = _merchantId(ctx);
  if (!merchantId) throw new Error(t`No hay un negocio seleccionado`);
  return _apiFetch(routes.staff.list(merchantId));
}

async function _loadRoles(ctx) {
  const merchantId = _merchantId(ctx);
  if (!merchantId) throw new Error(t`No hay un negocio seleccionado`);
  return _apiFetch(routes.roles.list(merchantId));
}

async function _loadGiftCards(ctx, opts) {
  if (!_active(ctx, 'cash')) return EMPTY_GIFT_CARDS;
  opts = opts || {};
  const q = new URLSearchParams({ page: String(opts.page || 1), limit: String(opts.limit || 20) });
  return _apiFetch(_merchantPath(ctx, '/cash/gift-cards?' + q));
}

async function _loadConversations(ctx, opts) {
  if (!_active(ctx, 'conversaflow')) return EMPTY_CONVERSATIONS;
  opts = opts || {};
  const q = new URLSearchParams({ page: String(opts.page || 1), limit: String(opts.limit || 20) });
  return _apiFetch(_merchantPath(ctx, '/conversaflow/conversations?' + q));
}

// The triage / attention queue: WhatsApp conversations where the customer is
// waiting on a reply (the bot ran, the last word is the customer's).
async function _loadTriage(ctx) {
  if (!_active(ctx, 'conversaflow')) return { conversations: [], total: 0 };
  return _apiFetch(_merchantPath(ctx, '/insights/triage'));
}

async function _loadOperations(ctx, domain, cursor, merchantWide, limit) {
  const merchantId = _merchantId(ctx);
  if (!merchantId) return EMPTY_OPERATIONS;
  const query = new URLSearchParams({
    domain: domain || 'organization',
    limit: String(limit || 20),
  });
  const locationId = merchantWide ? '' : _locationId(ctx);
  if (locationId) query.set('locationId', locationId);
  if (cursor) query.set('cursor', String(cursor));
  return _apiFetch(`${routes.merchants.operations(merchantId)}?${query}`);
}

// The Reportes → Ventas aggregate: net sales, product mix, payment mix, and a time
// series for a business-date range. Location-scoped like the operations snapshot.
async function _loadSalesSummary(ctx, range) {
  const merchantId = _merchantId(ctx);
  if (!merchantId) return null;
  const query = new URLSearchParams({ range: range || 'today' });
  const locationId = _locationId(ctx);
  if (locationId) query.set('locationId', locationId);
  return _apiFetch(`${routes.merchants.operations(merchantId)}/reports/sales?${query}`);
}

// The AI sales narrative over the Ventas summary (same range/scope). Optional and
// fail-safe: a null narrative means "hide the card", never an error.
async function _loadSalesInsight(ctx, range) {
  const merchantId = _merchantId(ctx);
  if (!merchantId) return EMPTY_SALES_INSIGHT;
  const query = new URLSearchParams({ range: range || 'today' });
  const locationId = _locationId(ctx);
  if (locationId) query.set('locationId', locationId);
  return _apiFetch(`${routes.merchants.operations(merchantId)}/reports/sales/insight?${query}`);
}

// One cash shift's reconciliation detail (roles, cash-math, denominations, ledger,
// counts, trazabilidad). Read on demand when the owner opens a shift in Caja y turnos.
async function _loadCashShiftDetail(ctx, shiftId) {
  const merchantId = _merchantId(ctx);
  if (!merchantId || !shiftId) return null;
  return _apiFetch(
    `${routes.merchants.operations(merchantId)}/cash-shifts/${encodeURIComponent(shiftId)}`,
  );
}

// One sale's receipt snapshot — the rendered sale, read on demand when the owner
// opens a sale in the money hub. Returns { receiptNumber, snapshot }.
async function loadSaleReceipt(saleId) {
  const merchantId = window.localStorage.getItem('umi-dashboard-selected-merchant');
  if (!merchantId) throw new Error(t`No hay un negocio seleccionado`);
  return _apiFetch(
    `${routes.merchants.operations(merchantId)}/sales/${encodeURIComponent(saleId)}/receipt`,
  );
}

async function executeAdministrativeCommand(operation, targetAggregateId, options) {
  const merchantId = window.localStorage.getItem('umi-dashboard-selected-merchant');
  const locationId = window.localStorage.getItem('umi-dashboard-selected-location');
  if (!merchantId) throw new Error(t`No hay un negocio seleccionado`);
  const input = options || {};
  const commandId = input.commandId || crypto.randomUUID();
  const idempotencyKey = input.idempotencyKey || crypto.randomUUID();
  const result = await _apiFetch(routes.merchants.administrativeCommands(merchantId), {
    method: 'POST',
    body: JSON.stringify({
      operation,
      locationId: input.locationId === undefined ? locationId || null : input.locationId,
      targetAggregateId,
      targetVersion: input.targetVersion ?? null,
      commandId,
      idempotencyKey,
      parameters: input.parameters || {},
      approvalId: input.approvalId || null,
    }),
  });
  return { result, commandId, idempotencyKey };
}

async function _loadBusinessHours(ctx) {
  if (!_active(ctx, 'conversaflow')) return EMPTY_HOURS;
  return _apiFetch(_withLocation(ctx, _merchantPath(ctx, '/conversaflow/hours')));
}

async function _loadVoiceConfig(ctx) {
  if (!_active(ctx, 'conversaflow')) return EMPTY_VOICE;
  return _apiFetch(_merchantPath(ctx, '/conversaflow/voice'));
}

async function saveMerchantSettings(patch) {
  const headers = await getAuthHeaders();
  const merchantId = window.localStorage.getItem('umi-dashboard-selected-merchant');
  if (!merchantId) throw new Error(t`No hay un negocio seleccionado`);
  return _apiFetch(`/api/merchants/${encodeURIComponent(merchantId)}/settings`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(patch),
  });
}

async function saveRewardConfig(patch) {
  const merchantId = window.localStorage.getItem('umi-dashboard-selected-merchant');
  if (!merchantId) throw new Error(t`No hay un negocio seleccionado`);
  return _apiFetch(`/api/merchants/${encodeURIComponent(merchantId)}/cash/reward-config`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

// Persist any combination of weekly hours, timezone, and the ordering window
// ({ acceptsOrders, orderCutoffMinutes, specialNotice, bypassPhones }). Each block is
// optional and only sent when provided, so a partial save — the pause toggle on its
// own — does not clobber the others server-side.
//
// The ordering block used to have no sender at all: the API accepted it and nothing
// called it, so the pause switch, the cutoff slider, the notice and the bypass list
// were all display-only.
async function saveBusinessHours(hours, timezone, ordering) {
  const merchantId = window.localStorage.getItem('umi-dashboard-selected-merchant');
  const locationId = window.localStorage.getItem('umi-dashboard-selected-location');
  if (!merchantId) throw new Error(t`No hay un negocio seleccionado`);
  const path = `/api/merchants/${encodeURIComponent(merchantId)}/conversaflow/hours${locationId ? `?locationId=${encodeURIComponent(locationId)}` : ''}`;
  const body = {};
  if (hours !== undefined && hours !== null) body.hours = hours;
  if (timezone !== undefined && timezone !== null) body.timezone = timezone;
  if (ordering !== undefined && ordering !== null) body.ordering = ordering;
  return _apiFetch(path, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

async function saveMerchantVoice(patch) {
  const merchantId = window.localStorage.getItem('umi-dashboard-selected-merchant');
  if (!merchantId) throw new Error(t`No hay un negocio seleccionado`);
  return _apiFetch(`/api/merchants/${encodeURIComponent(merchantId)}/conversaflow/voice`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

async function createStaffMember(staff) {
  const merchantId = window.localStorage.getItem('umi-dashboard-selected-merchant');
  if (!merchantId) throw new Error(t`No hay un negocio seleccionado`);
  return _apiFetch(routes.staff.create(merchantId), {
    method: 'POST',
    body: JSON.stringify(staff),
  });
}

async function updateStaffMember(id, patch) {
  const merchantId = window.localStorage.getItem('umi-dashboard-selected-merchant');
  if (!merchantId) throw new Error(t`No hay un negocio seleccionado`);
  return _apiFetch(routes.staff.update(merchantId, id), {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

async function deleteStaffMember(id) {
  const merchantId = window.localStorage.getItem('umi-dashboard-selected-merchant');
  if (!merchantId) throw new Error(t`No hay un negocio seleccionado`);
  return _apiFetch(routes.staff.remove(merchantId, id), { method: 'DELETE' });
}

async function createMerchantRole(role) {
  const merchantId = window.localStorage.getItem('umi-dashboard-selected-merchant');
  if (!merchantId) throw new Error(t`No hay un negocio seleccionado`);
  return _apiFetch(routes.roles.create(merchantId), {
    method: 'POST',
    body: JSON.stringify(role),
  });
}

async function updateMerchantRole(id, role) {
  const merchantId = window.localStorage.getItem('umi-dashboard-selected-merchant');
  if (!merchantId) throw new Error(t`No hay un negocio seleccionado`);
  return _apiFetch(routes.roles.update(merchantId, id), {
    method: 'PATCH',
    body: JSON.stringify(role),
  });
}

async function archiveMerchantRole(id, expectedRevision) {
  const merchantId = window.localStorage.getItem('umi-dashboard-selected-merchant');
  if (!merchantId) throw new Error(t`No hay un negocio seleccionado`);
  return _apiFetch(routes.roles.archive(merchantId, id, expectedRevision), { method: 'DELETE' });
}

// Credit several loyalty stamps to one card at once — the catch-up an operator does
// for a customer migrated from another loyalty program (the recurring "Agregar sellos"
// case). Writes merchant.loyalty_visit through the SAME endpoint the register uses;
// the merchant UUID is a valid `:merchantRef`. The server caps `seals` at 50 and the
// role guard already limits who may bulk-credit.
//
// The caller OWNS `idempotencyKey` and keeps it stable across retries: a credit that
// commits but loses its response must land once, not twice, when the operator clicks
// again. A fresh key per click would double-credit a money-adjacent balance.
async function creditLoyaltySeals({ cardId, seals, note, idempotencyKey }) {
  const merchantId = window.localStorage.getItem('umi-dashboard-selected-merchant');
  if (!merchantId) throw new Error(t`No hay un negocio seleccionado`);
  return _apiFetch(routes.cash.byRef.scanSeals(merchantId), {
    method: 'POST',
    body: JSON.stringify({
      cardId,
      seals,
      note: note || undefined,
      idempotencyKey: idempotencyKey || crypto.randomUUID(),
    }),
  });
}

// Add money to a customer's wallet from the dashboard. Same endpoint the register
// uses (`admin/topup`, staff-guarded). The caller owns `idempotencyKey` so a retried
// top-up after a lost response lands once, not twice, on a money balance.
async function topupWallet({ cardId, amountCentavos, note, idempotencyKey }) {
  const merchantId = window.localStorage.getItem('umi-dashboard-selected-merchant');
  if (!merchantId) throw new Error(t`No hay un negocio seleccionado`);
  return _apiFetch(routes.cash.byRef.topup(merchantId), {
    method: 'POST',
    body: JSON.stringify({
      cardId,
      amountCentavos,
      note: note || undefined,
      idempotencyKey: idempotencyKey || crypto.randomUUID(),
    }),
  });
}

// Register a loyalty visit or redeem a reward from the dashboard. Same endpoint the
// register scans into (`admin/scan`, staff-guarded): its resolver falls back from a
// signed QR to a plain CARD NUMBER, so the dashboard passes the card number it already
// shows. `action` is 'VISIT' (add a stamp) or 'REDEEM' (claim an earned reward); the
// API enforces the reward-cycle math and rejects a redeem with nothing to claim.
async function loyaltyScan({ cardNumber, action }) {
  const merchantId = window.localStorage.getItem('umi-dashboard-selected-merchant');
  if (!merchantId) throw new Error(t`No hay un negocio seleccionado`);
  return _apiFetch(routes.cash.byRef.scan(merchantId), {
    method: 'POST',
    body: JSON.stringify({ qrPayload: cardNumber, action }),
  });
}

// Build a merchant-scoped API path with the active location as `?locationId`.
// Centralizes the localStorage merchant/location lookup + missing-merchant guard
// that every KDS mutation shares.
function merchantScopedPath(basePath) {
  const merchantId = window.localStorage.getItem('umi-dashboard-selected-merchant');
  const locationId = window.localStorage.getItem('umi-dashboard-selected-location');
  if (!merchantId) throw new Error(t`No hay un negocio seleccionado`);
  return `/api/merchants/${encodeURIComponent(merchantId)}${basePath}${locationId ? `?locationId=${encodeURIComponent(locationId)}` : ''}`;
}

async function provisionDevice(device) {
  return _apiFetch(merchantScopedPath('/kds/devices/provision'), {
    method: 'POST',
    body: JSON.stringify(device),
  });
}

async function generateDevicePairingPin(device) {
  return _apiFetch(merchantScopedPath('/kds/devices/pairing-pin'), {
    method: 'POST',
    body: JSON.stringify(device),
  });
}

async function createPosEnrollmentRequest(device) {
  const merchantId = window.localStorage.getItem('umi-dashboard-selected-merchant');
  if (!merchantId) throw new Error(t`No hay un negocio seleccionado`);
  return _apiFetch(routes.devices.beginEnrollment(merchantId), {
    method: 'POST',
    body: JSON.stringify(device),
  });
}

function deviceEnrollmentPath(path, locationId) {
  if (!locationId) return path;
  return `${path}?locationId=${encodeURIComponent(locationId)}`;
}

async function getPosEnrollmentRequests(locationId) {
  const merchantId = window.localStorage.getItem('umi-dashboard-selected-merchant');
  if (!merchantId) throw new Error(t`No hay un negocio seleccionado`);
  return _apiFetch(deviceEnrollmentPath(routes.devices.enrollmentRequests(merchantId), locationId));
}

// The enrolled POS terminals, which are NOT the enrolment requests above: a request is
// a code waiting to be used, a device is a register in service. The Devices screen shows
// a request until it completes and the terminal itself from then on.
async function getPosDevices(locationId) {
  const merchantId = window.localStorage.getItem('umi-dashboard-selected-merchant');
  if (!merchantId) throw new Error(t`No hay un negocio seleccionado`);
  return _apiFetch(deviceEnrollmentPath(routes.devices.list(merchantId), locationId));
}

async function updatePosDevice(deviceId, patch, locationId) {
  const merchantId = window.localStorage.getItem('umi-dashboard-selected-merchant');
  if (!merchantId) throw new Error(t`No hay un negocio seleccionado`);
  return _apiFetch(deviceEnrollmentPath(routes.devices.update(merchantId, deviceId), locationId), {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

async function revokePosDevice(deviceId, reason) {
  const merchantId = window.localStorage.getItem('umi-dashboard-selected-merchant');
  if (!merchantId) throw new Error(t`No hay un negocio seleccionado`);
  return _apiFetch(routes.devices.revoke(merchantId, deviceId), {
    method: 'POST',
    body: JSON.stringify({ idempotencyKey: crypto.randomUUID(), reason }),
  });
}

async function approvePosEnrollmentRequest(requestId, locationId) {
  const merchantId = window.localStorage.getItem('umi-dashboard-selected-merchant');
  if (!merchantId) throw new Error(t`No hay un negocio seleccionado`);
  return _apiFetch(
    deviceEnrollmentPath(routes.devices.approveEnrollment(merchantId, requestId), locationId),
    {
      method: 'POST',
      body: JSON.stringify({ idempotencyKey: crypto.randomUUID() }),
    },
  );
}

async function denyPosEnrollmentRequest(requestId, locationId) {
  const merchantId = window.localStorage.getItem('umi-dashboard-selected-merchant');
  if (!merchantId) throw new Error(t`No hay un negocio seleccionado`);
  return _apiFetch(
    deviceEnrollmentPath(routes.devices.denyEnrollment(merchantId, requestId), locationId),
    {
      method: 'POST',
      body: JSON.stringify({ idempotencyKey: crypto.randomUUID() }),
    },
  );
}

// ── Mercado Pago Point: the café's own account, and its terminals (Phase 5) ──
//
// `routes` has no `mpPoint` group yet, so these routes are addressed by their ids in
// the route table — the single author of the URL space — rather than by a path typed here.
//
// NOTHING IN THIS SECTION EVER CARRIES A TOKEN. The status route answers with the account
// and the token's HEALTH; the authorization route answers with a URL to send the BROWSER
// to, and the exchange happens server-side on the way back. The screen cannot leak what it
// is never given.

function _mpPointMerchantId() {
  const merchantId = window.localStorage.getItem('umi-dashboard-selected-merchant');
  if (!merchantId) throw new Error(t`No hay un negocio seleccionado`);
  return merchantId;
}

async function getMpPointCredentialStatus() {
  return _apiFetch(buildPath('mpPoint.status', { merchantId: _mpPointMerchantId() }));
}

/**
 * Where to send the seller, and when that invitation stops being valid. The caller performs
 * a FULL navigation to `url` — the vendor's page is where the approval happens — so this is
 * a read, not a mutation, and the outcome arrives on the callback's redirect to `/devices`.
 */
async function getMpPointAuthorization() {
  return _apiFetch(buildPath('mpPoint.authorize', { merchantId: _mpPointMerchantId() }));
}

async function getMpPointTerminals() {
  return _apiFetch(buildPath('mpPoint.terminalList', { merchantId: _mpPointMerchantId() }));
}

/**
 * Binding a terminal to a register, and choosing which side drives it, in ONE call: the
 * route takes the complete binding, so a mode switch that did not restate the register (or
 * the reverse) would be a half-write the database's `unique (device_id)` would refuse.
 */
async function bindMpPointTerminal(terminalId, binding) {
  return _apiFetch(
    buildPath('mpPoint.terminalBind', { merchantId: _mpPointMerchantId(), terminalId }),
    {
      method: 'PUT',
      body: JSON.stringify({
        terminalId,
        deviceId: binding.deviceId,
        locationId: binding.locationId,
        operatingMode: binding.operatingMode,
      }),
    },
  );
}

/** The register keeps its credential; the terminal simply stops belonging to it. */
async function unbindMpPointTerminal(terminalId) {
  return _apiFetch(
    buildPath('mpPoint.terminalUnbind', { merchantId: _mpPointMerchantId(), terminalId }),
    { method: 'DELETE' },
  );
}

/**
 * STOP CHARGING THIS ACCOUNT.
 *
 * The server answers with the status AFTER the change, so the caller re-renders from the
 * answer rather than from an assumption — and the route is idempotent, so a double click is
 * one unlink. A DELETE verb and no body: the vendor-side material is what ends, and the
 * café's row survives it (`mpPoint.disconnect` in the route table says why).
 */
async function disconnectMpPointAccount() {
  return _apiFetch(buildPath('mpPoint.disconnect', { merchantId: _mpPointMerchantId() }), {
    method: 'DELETE',
  });
}

/**
 * CREATE THE CAFÉ'S ONE STORE, from the address an operator typed.
 *
 * The vendor requires a store before it will hold a point of sale, and it validates the
 * address against its own catalogue — so the address is the one field on this screen that a
 * PERSON supplies and no code here invents. A POST with no idempotency key is still one
 * store: the server derives the vendor's `external_id` from the merchant, so a retry
 * collides at the vendor rather than opening a second store with a second fiscal address.
 *
 * The refusal that matters is `MP_POINT_STORE_REFUSED`, whose `details.vendorCode` names
 * WHICH field the vendor rejected (`invalid_city` and friends); the screen shows that code,
 * because "the address was refused" leaves the operator with nothing to change.
 */
async function createMpPointStore(address) {
  return _apiFetch(buildPath('mpPoint.storeCreate', { merchantId: _mpPointMerchantId() }), {
    method: 'POST',
    body: JSON.stringify({
      name: address.name,
      streetName: address.streetName,
      streetNumber: address.streetNumber,
      cityName: address.cityName,
      stateName: address.stateName,
      latitude: address.latitude,
      longitude: address.longitude,
      reference: address.reference,
    }),
  });
}

const EMPTY_MP_POINT = { status: null, terminals: null };

async function _loadMpPoint(ctx) {
  const merchantId = _merchantId(ctx);
  if (!merchantId) throw new Error(t`No hay un negocio seleccionado`);
  const status = await _apiFetch(buildPath('mpPoint.status', { merchantId }));
  // A café with no credential has no terminal list to read: that list is the VENDOR's
  // answer about that merchant's account, so asking for it without one is a guaranteed
  // refusal. `terminals: null` says "never asked", which the screen renders as the same
  // connect prompt rather than as an error the operator cannot act on.
  if (!status.connected) return { status, terminals: null };
  const list = await _apiFetch(buildPath('mpPoint.terminalList', { merchantId }));
  return { status, terminals: list.terminals || [] };
}

/**
 * The account and its terminals, read as one picture for the same reason the POS
 * enrollment pair is: a terminal row without its account says nothing about which API key
 * a row's left half and its controls come from.
 */
function useMpPointData(refresh) {
  const ctx = useMerchant();
  return _useAsync(
    function () {
      return _loadMpPoint(ctx);
    },
    _deps(ctx, [refresh || 0]),
    EMPTY_MP_POINT,
  );
}

async function createKdsStation(station) {
  const result = await executeAdministrativeCommand('kitchen.station.create', crypto.randomUUID(), {
    parameters: station,
  });
  return result.result;
}

async function updateKdsStation(stationId, patch) {
  const result = await executeAdministrativeCommand('kitchen.station.update', stationId, {
    parameters: patch,
  });
  return result.result;
}

async function deleteKdsStation(stationId) {
  const result = await executeAdministrativeCommand('kitchen.station.update', stationId, {
    parameters: { archive: true },
  });
  return result.result;
}

async function approveDevicePairing(pairingId) {
  return _apiFetch(
    merchantScopedPath(`/kds/devices/pairing/${encodeURIComponent(pairingId)}/approve`),
    { method: 'POST' },
  );
}

async function denyDevicePairing(pairingId) {
  return _apiFetch(
    merchantScopedPath(`/kds/devices/pairing/${encodeURIComponent(pairingId)}/deny`),
    {
      method: 'POST',
    },
  );
}

async function updateDevice(deviceId, patch) {
  const result = await executeAdministrativeCommand('kitchen.device.assign', deviceId, {
    parameters: patch,
  });
  return result.result;
}

async function revokeDevice(deviceId, reason) {
  return _apiFetch(merchantScopedPath(`/kds/devices/${encodeURIComponent(deviceId)}/revoke`), {
    method: 'POST',
    body: JSON.stringify({ reason: reason || 'removed_from_dashboard' }),
  });
}

async function transitionOrder(orderId, targetStatus, extra) {
  const merchantId = window.localStorage.getItem('umi-dashboard-selected-merchant');
  const locationId = window.localStorage.getItem('umi-dashboard-selected-location');
  if (!merchantId) throw new Error(t`No hay un negocio seleccionado`);
  const path = `/api/merchants/${encodeURIComponent(merchantId)}/orders/${encodeURIComponent(orderId)}/transition${locationId ? `?locationId=${encodeURIComponent(locationId)}` : ''}`;
  return _apiFetch(path, {
    method: 'POST',
    body: JSON.stringify(Object.assign({ target_status: targetStatus }, extra || {})),
  });
}

function useOverviewData(refresh) {
  const ctx = useMerchant();
  return _useAsync(
    function () {
      return _loadOverviewAndStations(ctx);
    },
    _deps(ctx, [refresh]),
    { overview: EMPTY_OVERVIEW, stations: EMPTY_STATIONS, ticker: EMPTY_TICKER },
  );
}

function useDevicesData(refresh) {
  const ctx = useMerchant();
  return _useAsync(
    function () {
      return _loadDevices(ctx);
    },
    _deps(ctx, [refresh]),
    EMPTY_DEVICES,
  );
}

function useKdsStations(refresh) {
  const ctx = useMerchant();
  return _useAsync(
    function () {
      return _loadKdsStations(ctx);
    },
    _deps(ctx, [refresh || 0]),
    EMPTY_STATIONS_KDS,
  );
}

function useDevicePairings(refresh) {
  const ctx = useMerchant();
  return _useAsync(
    function () {
      return _loadDevicePairings(ctx);
    },
    _deps(ctx, [refresh || 0]),
    EMPTY_PAIRINGS,
  );
}

function useMerchantData() {
  const ctx = useMerchant();
  return _useAsync(
    function () {
      return _loadMerchant(ctx);
    },
    _deps(ctx),
    EMPTY_MERCHANT,
  );
}

function useOrdersData(filter, refresh, channel) {
  const ctx = useMerchant();
  return _useAsync(
    function () {
      return _loadOrders(ctx, filter, channel);
    },
    _deps(ctx, [filter, refresh, channel || '']),
    EMPTY_ORDERS,
  );
}

function useStaffData(refresh) {
  const ctx = useMerchant();
  return _useAsync(
    function () {
      return _loadStaff(ctx);
    },
    _deps(ctx, [refresh || 0]),
    EMPTY_STAFF,
  );
}

function useRolesData(refresh) {
  const ctx = useMerchant();
  return _useAsync(
    function () {
      return _loadRoles(ctx);
    },
    _deps(ctx, [refresh || 0]),
    EMPTY_ROLES,
  );
}

function useBusinessHours() {
  const ctx = useMerchant();
  return _useAsync(
    function () {
      return _loadBusinessHours(ctx);
    },
    _deps(ctx),
    EMPTY_HOURS,
  );
}

function useVoiceConfig() {
  const ctx = useMerchant();
  return _useAsync(
    function () {
      return _loadVoiceConfig(ctx);
    },
    _deps(ctx),
    EMPTY_VOICE,
  );
}

function useMembersData(opts) {
  const ctx = useMerchant();
  var page = opts && opts.page ? opts.page : 1;
  var search = opts && opts.search ? opts.search : '';
  var sort = opts && opts.sort ? opts.sort : 'recent';
  var refresh = (opts && opts.refresh) || 0;
  return _useAsync(
    function () {
      return _loadMembers(ctx, { page: page, search: search, sort: sort });
    },
    _deps(ctx, [page, search, sort, refresh]),
    EMPTY_MEMBERS,
  );
}

// Keyset-paged customer list on TanStack Query's infinite cache. The list orders by
// the indexed last_activity_at, and the backend returns an opaque `nextCursor`; there
// is no page number and no total-count query.
function useCustomersData(opts) {
  const ctx = useMerchant();
  const merchantId = _merchantId(ctx);
  const search = opts && opts.search ? opts.search : '';
  const filter = opts && opts.filter ? opts.filter : '';
  const ctxRef = useRefD(ctx);
  useEffectD(
    function () {
      ctxRef.current = ctx;
    },
    [ctx],
  );
  const query = useInfiniteQuery({
    queryKey: ['customers', merchantId || '', search, filter],
    queryFn: function (arg) {
      return _loadCustomers(ctxRef.current, {
        cursor: arg.pageParam,
        search: search,
        filter: filter,
        limit: 20,
      });
    },
    initialPageParam: null,
    getNextPageParam: function (lastPage) {
      return (lastPage && lastPage.nextCursor) || undefined;
    },
    enabled: Boolean(merchantId),
  });
  const customers = useMemoD(
    function () {
      return query.data && query.data.pages
        ? query.data.pages.flatMap(function (p) {
            return p.customers || [];
          })
        : [];
    },
    [query.data],
  );
  return {
    customers: customers,
    loading: query.isLoading,
    error: query.isError ? (query.error && query.error.message) || 'error' : null,
    hasMore: Boolean(query.hasNextPage),
    loadingMore: query.isFetchingNextPage,
    fetchMore: query.fetchNextPage,
    source: query.data && query.data.pages && query.data.pages[0] ? query.data.pages[0].source : '',
  };
}

function useCustomerDetail(customerId, refresh) {
  const ctx = useMerchant();
  return _useAsync(
    function () {
      return _loadCustomerDetail(ctx, customerId);
    },
    _deps(ctx, [customerId || '', refresh || 0]),
    EMPTY_CUSTOMER_DETAIL,
  );
}

// A large fixed base so prepending OLDER messages only ever decreases the index of
// the first row; the newest message keeps a stable index, which is what lets
// react-virtuoso hold scroll position on prepend.
const TRANSCRIPT_START_INDEX = 1_000_000;

// The WhatsApp transcript: keyset history via TanStack Query's infinite cache, PLUS
// a live overlay. A realtime nudge (Socket.IO, driven by a Postgres NOTIFY on the
// message insert) pulls the freshest page and merges it over the history by id, so
// a new message appends at the bottom without disturbing scroll-up (older) paging.
// Returns display-ready `messages` (oldest→newest, deduped) and a `firstItemIndex`
// that moves ONLY on prepend.
function useConversationMessages(customerId, conversationId) {
  const ctx = useMerchant();
  const merchantId = _merchantId(ctx);
  const ctxRef = useRefD(ctx);
  useEffectD(
    function () {
      ctxRef.current = ctx; // keep the nudge's fetch closure on the current merchant ctx
    },
    [ctx],
  );

  const infinite = useInfiniteQuery({
    queryKey: [
      'customer',
      merchantId || '',
      customerId || '',
      'conversation',
      conversationId || '',
      'messages',
    ],
    queryFn: ({ pageParam }) =>
      _loadConversationMessages(ctxRef.current, customerId, conversationId, pageParam),
    initialPageParam: null,
    getNextPageParam: (lastPage) => lastPage?.nextCursor ?? undefined,
    enabled: Boolean(merchantId && customerId && conversationId),
  });

  // The overlay is tagged with its conversation id, so a stale overlay from a
  // previously-open thread is simply ignored below — no reset effect needed.
  const [live, setLive] = useStateD({ id: null, messages: [] });
  useEffectD(
    function () {
      if (!merchantId || !customerId || !conversationId) return undefined;
      let active = true;
      const off = subscribeConversationMessages({
        merchantId,
        conversationId,
        onNudge: function () {
          _loadConversationMessages(ctxRef.current, customerId, conversationId, null)
            .then(function (page) {
              if (active) setLive({ id: conversationId, messages: (page && page.messages) || [] });
            })
            .catch(function () {});
        },
      });
      return function () {
        active = false;
        off();
      };
    },
    [merchantId, customerId, conversationId],
  );

  const messages = useMemoD(
    function () {
      const byId = new Map();
      const pages = infinite.data && infinite.data.pages;
      if (pages) {
        for (const page of pages) for (const m of page.messages || []) byId.set(m.id, m);
      }
      const liveMessages = live.id === conversationId ? live.messages : [];
      for (const m of liveMessages) byId.set(m.id, m);
      return Array.from(byId.values()).sort(function (a, b) {
        if (a.occurredAt < b.occurredAt) return -1;
        if (a.occurredAt > b.occurredAt) return 1;
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      });
    },
    [infinite.data, live, conversationId],
  );

  const pages = (infinite.data && infinite.data.pages) || [];
  const firstPageLen = pages[0] && pages[0].messages ? pages[0].messages.length : 0;
  let historyLen = 0;
  for (const page of pages) historyLen += (page.messages || []).length;
  const olderLoaded = Math.max(0, historyLen - firstPageLen);
  const firstItemIndex = TRANSCRIPT_START_INDEX - olderLoaded;

  return {
    messages,
    firstItemIndex,
    fetchOlder: infinite.fetchNextPage,
    hasOlder: infinite.hasNextPage,
    isFetchingOlder: infinite.isFetchingNextPage,
    isLoading: infinite.isLoading,
    isError: infinite.isError,
    error: infinite.error,
  };
}

function useCustomerInsights(refresh) {
  const ctx = useMerchant();
  return _useAsync(
    function () {
      return _loadCustomerInsights(ctx);
    },
    _deps(ctx, [refresh || 0]),
    EMPTY_CUSTOMER_INSIGHTS,
  );
}

function useCustomerDescription(customerId, refresh) {
  const ctx = useMerchant();
  return _useAsync(
    function () {
      return _loadCustomerDescription(ctx, customerId);
    },
    _deps(ctx, [customerId || '', refresh || 0]),
    EMPTY_CUSTOMER_DESCRIPTION,
  );
}

function useGiftCardsData(opts) {
  const ctx = useMerchant();
  var page = opts && opts.page ? opts.page : 1;
  var refresh = (opts && opts.refresh) || 0;
  return _useAsync(
    function () {
      return _loadGiftCards(ctx, { page: page });
    },
    _deps(ctx, [page, refresh]),
    EMPTY_GIFT_CARDS,
  );
}

// Issue a gift card from the dashboard. Same endpoint the register uses
// (`admin/gift-cards`, staff-guarded); the merchant UUID is a valid `:merchantRef`.
// The clear code comes back ONCE, in the response — it is never stored in clear and
// never returned by a later read, so the caller must show it to the operator now.
async function issueGiftCard({
  amountCentavos,
  recipientName,
  recipientEmail,
  recipientPhone,
  senderName,
  message,
}) {
  const merchantId = window.localStorage.getItem('umi-dashboard-selected-merchant');
  if (!merchantId) throw new Error(t`No hay un negocio seleccionado`);
  return _apiFetch(routes.cash.byRef.giftCards(merchantId), {
    method: 'POST',
    body: JSON.stringify({
      amountCentavos,
      recipientName: recipientName || undefined,
      recipientEmail: recipientEmail || undefined,
      recipientPhone: recipientPhone || undefined,
      senderName: senderName || undefined,
      message: message || undefined,
    }),
  });
}

// Register a new loyalty member from the dashboard. Same endpoint the customer
// self-service page uses; it returns the new card in the BODY (no cookies), so it
// does not touch the operator's dashboard session. `phone` is the assembled
// `+<dial><national>` the API validates against the country's digit count.
async function registerMember({ name, phone, birthDate }) {
  const merchantId = window.localStorage.getItem('umi-dashboard-selected-merchant');
  if (!merchantId) throw new Error(t`No hay un negocio seleccionado`);
  return _apiFetch(routes.cash.byRef.registerMember(merchantId), {
    method: 'POST',
    body: JSON.stringify({ name, phone, birthDate }),
  });
}

// Redeem a gift card by code onto the identified customer's wallet. The register
// uses the same public endpoint; the operator supplies the code and the customer's
// phone or email. The API rejects an already-redeemed / expired / empty code.
async function redeemGiftCardByCode({ code, phone, email }) {
  const merchantId = window.localStorage.getItem('umi-dashboard-selected-merchant');
  if (!merchantId) throw new Error(t`No hay un negocio seleccionado`);
  return _apiFetch(routes.cash.byRef.gift(merchantId, code.trim().toUpperCase()), {
    method: 'POST',
    body: JSON.stringify({ phone: phone || undefined, email: email || undefined }),
  });
}

function useConversationsData(opts) {
  const ctx = useMerchant();
  var page = opts && opts.page ? opts.page : 1;
  return _useAsync(
    function () {
      return _loadConversations(ctx, { page: page });
    },
    _deps(ctx, [page]),
    EMPTY_CONVERSATIONS,
  );
}

function useTriageData() {
  const ctx = useMerchant();
  return _useAsync(
    function () {
      return _loadTriage(ctx);
    },
    _deps(ctx, []),
    { conversations: [], total: 0 },
  );
}

function useOperationsData(domain, cursor, refresh, merchantWide, limit) {
  const ctx = useMerchant();
  return _useAsync(
    function () {
      return _loadOperations(ctx, domain, cursor, merchantWide, limit);
    },
    _deps(ctx, [
      domain || 'organization',
      cursor || 0,
      refresh || 0,
      merchantWide ? 1 : 0,
      limit || 20,
    ]),
    EMPTY_OPERATIONS,
  );
}

// The Reportes → Ventas aggregate for a range ('today' | 'yesterday' | 'last_7_days' |
// 'last_30_days'). Re-fetches when the range, merchant, or location changes.
function useSalesSummary(range, refresh) {
  const ctx = useMerchant();
  return _useAsync(
    function () {
      return _loadSalesSummary(ctx, range);
    },
    _deps(ctx, [range || 'today', refresh || 0]),
    null,
  );
}

// The AI sales narrative for the current range/scope. Lazy companion to useSalesSummary;
// seeds empty and hides itself on a null narrative (fail-safe).
function useSalesInsight(range, refresh) {
  const ctx = useMerchant();
  return _useAsync(
    function () {
      return _loadSalesInsight(ctx, range);
    },
    _deps(ctx, [range || 'today', refresh || 0]),
    EMPTY_SALES_INSIGHT,
  );
}

// One cash shift's reconciliation detail for the Caja y turnos drill-down. Null shiftId
// means no shift is selected; re-fetches when the shift or merchant changes.
function useCashShiftDetail(shiftId, refresh) {
  const ctx = useMerchant();
  return _useAsync(
    function () {
      return _loadCashShiftDetail(ctx, shiftId);
    },
    _deps(ctx, [shiftId || '', refresh || 0]),
    null,
  );
}

// One committed sale's receipt snapshot (lines, tender, operator, totals) for the money-hub
// sale detail. A null saleId means no sale is open; re-fetches when the sale, merchant, or
// location changes. Returns { receiptNumber, snapshot } or null.
function useSaleReceipt(saleId, refresh) {
  const ctx = useMerchant();
  return _useAsync(
    function () {
      return saleId ? loadSaleReceipt(saleId) : Promise.resolve(null);
    },
    _deps(ctx, [saleId || '', refresh || 0]),
    null,
  );
}

// Polls /api/health and tracks connectivity to the dashboard backend.
// status: 'connecting' | 'online' | 'offline'
// Retries every 5 s while offline, every 20 s while online.
// retry() triggers an immediate re-check.
function useKdsConnection() {
  const [status, setStatus] = useStateD('connecting');
  const [latency, setLatency] = useStateD(null);
  const [seq, setSeq] = useStateD(0); // bump to force immediate re-check

  useEffectD(
    function () {
      let cancelled = false;

      async function check() {
        const t0 = Date.now();
        const ctrl = new AbortController();
        const timeout = setTimeout(() => ctrl.abort(), 5000);
        try {
          const res = await fetch(apiUrl('/health'), {
            cache: 'no-store',
            signal: ctrl.signal,
          });
          clearTimeout(timeout);
          if (cancelled) return;
          if (res.ok) {
            setStatus('online');
            setLatency(Date.now() - t0);
          } else {
            setStatus('offline');
            setLatency(null);
          }
        } catch {
          clearTimeout(timeout);
          if (!cancelled) {
            setStatus('offline');
            setLatency(null);
          }
        }
      }

      check();
      const delay = status === 'offline' ? 5000 : 20000;
      const id = setInterval(check, delay);
      return function () {
        cancelled = true;
        clearInterval(id);
      };
    },
    [status, seq],
  );

  return {
    status,
    latency,
    retry: function () {
      setSeq(function (s) {
        return s + 1;
      });
    },
  };
}

async function getLocationProfiles() {
  const merchantId = window.localStorage.getItem('umi-dashboard-selected-merchant');
  if (!merchantId) throw new Error(t`No hay un negocio seleccionado`);
  const res = await _apiFetch(
    `/api/merchants/${encodeURIComponent(merchantId)}/locations/profiles`,
  );
  return res?.locations || [];
}

async function saveLocationProfile(locationId, patch) {
  const merchantId = window.localStorage.getItem('umi-dashboard-selected-merchant');
  if (!merchantId) throw new Error(t`No hay un negocio seleccionado`);
  const res = await _apiFetch(
    `/api/merchants/${encodeURIComponent(merchantId)}/locations/${encodeURIComponent(locationId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify(patch),
    },
  );
  return res?.location || null;
}

async function createLocation(input) {
  const merchantId = window.localStorage.getItem('umi-dashboard-selected-merchant');
  if (!merchantId) throw new Error(t`No hay un negocio seleccionado`);
  const res = await _apiFetch(`/api/merchants/${encodeURIComponent(merchantId)}/locations`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return res?.location || null;
}

/**
 * Address → coordinates, for the branch editor's "find it" button.
 *
 * Returns null when nothing matched — which the endpoint reports as a 200 with a
 * null body, not a 404, so this reads the body rather than catching. A geocode is
 * a convenience: the operator can always type the pin, so a miss is an answer.
 */
async function geocodeAddress(address) {
  const res = await _apiFetch(`/api/geocode?address=${encodeURIComponent(address)}`);
  return res?.location || null;
}

// ── Platform: the cafés themselves ──────────────────────────────────────────
// `GET /api/me/merchants` already answers this: for a login holding a platform
// grant it lists EVERY active café, not only the ones she is staff at. No second
// endpoint, and no way for the list to disagree with the merchant switcher.
const EMPTY_CAFES = { cafes: [] };

async function _loadCafes() {
  const res = await _apiFetch(routes.me.merchants, { method: 'GET' });
  return { cafes: (res && res.merchants) || [] };
}

function useCafes(refresh) {
  return _useAsync(_loadCafes, [refresh || 0], EMPTY_CAFES);
}

/**
 * Open a café. `POST /api/merchants`, platform administrators only.
 *
 * Errors arrive as `{ error: <code>, message }` and `_apiFetch` puts the code on
 * `err.code` and the sentence on `err.message`, so a caller branches on the code
 * and shows the sentence.
 */
async function provisionCafe(payload) {
  return _apiFetch(routes.merchants.provision, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

// ── Catalog categories: the POS colour the owner edits, populated from products ──
const EMPTY_CATEGORIES = { items: [] };

async function _loadCatalogCategories(ctx) {
  const merchantId = _merchantId(ctx);
  if (!merchantId) return EMPTY_CATEGORIES;
  const res = await _apiFetch(
    `/api/merchants/${encodeURIComponent(merchantId)}/catalog/categories`,
  );
  return { items: (res && res.items) || [] };
}

function useCatalogCategories(refresh) {
  const ctx = useMerchant();
  return _useAsync(
    function () {
      return _loadCatalogCategories(ctx);
    },
    _deps(ctx, [refresh || 0]),
    EMPTY_CATEGORIES,
  );
}

async function createCatalogCategory(input) {
  const merchantId = window.localStorage.getItem('umi-dashboard-selected-merchant');
  if (!merchantId) throw new Error(t`No hay un negocio seleccionado`);
  return _apiFetch(`/api/merchants/${encodeURIComponent(merchantId)}/catalog/categories`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

async function updateCatalogCategory(categoryId, patch) {
  const merchantId = window.localStorage.getItem('umi-dashboard-selected-merchant');
  if (!merchantId) throw new Error(t`No hay un negocio seleccionado`);
  return _apiFetch(
    `/api/merchants/${encodeURIComponent(merchantId)}/catalog/categories/${encodeURIComponent(categoryId)}`,
    { method: 'PATCH', body: JSON.stringify(patch) },
  );
}

export {
  useCafes,
  provisionCafe,
  useOverviewData,
  useDevicesData,
  useMerchantData,
  useOrdersData,
  useKdsStations,
  useDevicePairings,
  useMembersData,
  useCustomersData,
  useCustomerDetail,
  useConversationMessages,
  useCustomerInsights,
  useCustomerDescription,
  useStaffData,
  useRolesData,
  useBusinessHours,
  useVoiceConfig,
  useGiftCardsData,
  useConversationsData,
  useTriageData,
  // This hook follows the existing data module boundary. Do not increase the warning baseline.
  // eslint-disable-next-line react-refresh/only-export-components
  useOperationsData,
  // eslint-disable-next-line react-refresh/only-export-components
  useSalesSummary,
  useSalesInsight,
  // eslint-disable-next-line react-refresh/only-export-components
  useCashShiftDetail,
  // eslint-disable-next-line react-refresh/only-export-components
  useSaleReceipt,
  // eslint-disable-next-line react-refresh/only-export-components
  executeAdministrativeCommand,
  // eslint-disable-next-line react-refresh/only-export-components
  loadSaleReceipt,
  saveMerchantSettings,
  saveRewardConfig,
  saveBusinessHours,
  saveMerchantVoice,
  getLocationProfiles,
  saveLocationProfile,
  createLocation,
  geocodeAddress,
  createStaffMember,
  updateStaffMember,
  deleteStaffMember,
  createMerchantRole,
  updateMerchantRole,
  archiveMerchantRole,
  // Data-module function, not a component. Keeps the react-refresh baseline flat.
  // eslint-disable-next-line react-refresh/only-export-components
  creditLoyaltySeals,
  // eslint-disable-next-line react-refresh/only-export-components
  topupWallet,
  // eslint-disable-next-line react-refresh/only-export-components
  loyaltyScan,
  // eslint-disable-next-line react-refresh/only-export-components
  issueGiftCard,
  // eslint-disable-next-line react-refresh/only-export-components
  redeemGiftCardByCode,
  // eslint-disable-next-line react-refresh/only-export-components
  registerMember,
  provisionDevice,
  generateDevicePairingPin,
  createPosEnrollmentRequest,
  getPosEnrollmentRequests,
  getPosDevices,
  updatePosDevice,
  revokePosDevice,
  approvePosEnrollmentRequest,
  denyPosEnrollmentRequest,
  // Data-module functions, not components. They carry the disable for the same reason
  // `creditLoyaltySeals` above does: this file has always been a data module, and the rule
  // exists to protect fast refresh in files that export components. Marking them keeps the
  // baseline flat instead of raising it once per feature.
  // eslint-disable-next-line react-refresh/only-export-components
  getMpPointCredentialStatus,
  // eslint-disable-next-line react-refresh/only-export-components
  getMpPointAuthorization,
  // eslint-disable-next-line react-refresh/only-export-components
  getMpPointTerminals,
  // eslint-disable-next-line react-refresh/only-export-components
  bindMpPointTerminal,
  // eslint-disable-next-line react-refresh/only-export-components
  unbindMpPointTerminal,
  // eslint-disable-next-line react-refresh/only-export-components
  disconnectMpPointAccount,
  // eslint-disable-next-line react-refresh/only-export-components
  createMpPointStore,
  // eslint-disable-next-line react-refresh/only-export-components
  useMpPointData,
  approveDevicePairing,
  denyDevicePairing,
  updateDevice,
  revokeDevice,
  transitionOrder,
  createKdsStation,
  updateKdsStation,
  deleteKdsStation,
  useKdsConnection,
  // eslint-disable-next-line react-refresh/only-export-components
  useCatalogCategories,
  // eslint-disable-next-line react-refresh/only-export-components
  createCatalogCategory,
  // eslint-disable-next-line react-refresh/only-export-components
  updateCatalogCategory,
  _LIVE as DATA_IS_LIVE,
};

// ── Floor plan (workstream D) ────────────────────────────────────────────────
// Both halves capture the location at the CALL SITE. The editor's autosave can
// land after the operator has switched branch in the topbar, and a save that
// carried the new branch's id would rewrite a dining room nobody is looking at —
// so the caller passes the scope it drew, never a value read at send time.
//
// They stay in this module, and carry the same suppression as the other
// non-component exports above, because `_apiFetch` is what gives them the
// cookie-session recovery (a save landing on an expired access cookie must
// refresh and retry, not fall over).
// eslint-disable-next-line react-refresh/only-export-components
export function fetchFloorPlan(merchantId, locationId) {
  return _apiFetch(
    `${buildPath('floorPlan.read', { merchantId })}?locationId=${encodeURIComponent(locationId)}`,
  );
}
// eslint-disable-next-line react-refresh/only-export-components
export function changeFloorPlan(merchantId, payload, publish = false) {
  return _apiFetch(buildPath(publish ? 'floorPlan.publish' : 'floorPlan.save', { merchantId }), {
    method: publish ? 'POST' : 'PUT',
    body: JSON.stringify(payload),
  });
}

// The live state of the room, for the map the same screen edits (workstream D
// steps 3 and 5). The layout above says which tables exist; this says who is on
// them. It is a separate read with a separate lifetime — the editor is open for
// minutes and a seating lasts ninety — so the screen polls one and not the other.
//
// A read failure is NOT a load failure. The editor keeps working on the last
// room it saw, because a manager who cannot read the room must still be able to
// edit the floor.
// eslint-disable-next-line react-refresh/only-export-components
export function fetchTableState(merchantId, locationId) {
  return _apiFetch(
    `${buildPath('tableState.read', { merchantId })}?locationId=${encodeURIComponent(locationId)}`,
  );
}

// ── Inventory costing: the cost of a plate, a day, and what is about to run out ──
//
// Workstream E steps 5 and 6, rendered by the Costos y márgenes screen. Four reads,
// gated by `merchant.manage` like purchasing — an owner's question about money, not an
// operator's about stock, which is why a dashboard session can reach them and the
// till's `inventory.*` keys are not involved.
//
// ⚠️ THE WINDOW IS THE SERVER'S, NOT THE BROWSER'S. A business date belongs to the
// café's timezone, so a screen that computed its own "today" would ask a different
// question than the API answers. The first read is `low-stock` with just a length,
// and the `from`/`to` it echoes back are the window every other read is then given.
// No date arithmetic happens in this module at all.
//
// ⚠️ ONE FAILING READ IS NOT A BLANK SCREEN. The three reads that hang off the window
// go out together and are allowed to fail separately: a menu with no recipes has no
// plates to cost but still has stock to forecast, and a person who came to see what is
// about to run out should not be shown nothing because the margin column is empty.
// `partial` names the reads that failed, so the screen can say which.
//
// `includeUnmapped` is deliberate, and it is D47's rule applied to this screen: a
// product nobody said what it consumes costs an UNKNOWN amount, and asking only for
// the mapped ones would leave the café's 121 un-reciped products invisible. The screen
// counts them in the open, so "no recipe" is a number a person can act on.
const EMPTY_COSTING = {
  window: null,
  days: [],
  plates: [],
  forecast: [],
  basis: [],
  receiptLocations: [],
  truncated: false,
  partial: [],
};

async function _loadInventoryCosting(ctx, rangeDays) {
  const merchantId = _merchantId(ctx);
  if (!merchantId) return EMPTY_COSTING;
  const length = Number(rangeDays) > 0 ? Number(rangeDays) : 28;

  const forecast = await _apiFetch(
    _withLocation(ctx, _merchantPath(ctx, `/inventory-costing/low-stock?windowDays=${length}`)),
  );
  const from = forecast.from;
  const to = forecast.to;

  const [daysRead, platesRead, basisRead] = await Promise.allSettled([
    _apiFetch(
      _withLocation(ctx, _merchantPath(ctx, `/inventory-costing/days?from=${from}&to=${to}`)),
    ),
    _apiFetch(
      _merchantPath(
        ctx,
        `/inventory-costing/plates?includeUnmapped=true&consumptionFrom=${from}&consumptionTo=${to}&limit=200`,
      ),
    ),
    _apiFetch(_merchantPath(ctx, '/inventory-costing/cost-basis?includeWithoutReceipts=true')),
  ]);

  const partial = [];
  if (daysRead.status !== 'fulfilled') partial.push('days');
  if (platesRead.status !== 'fulfilled') partial.push('plates');
  if (basisRead.status !== 'fulfilled') partial.push('basis');
  if (partial.length === 3) {
    const first = [daysRead, platesRead, basisRead].find((read) => read.status === 'rejected');
    throw first.reason ?? new Error(t`No se pudo leer el costo`);
  }

  return {
    window: { from, to, days: forecast.windowDays, locationId: forecast.locationId ?? null },
    days: daysRead.status === 'fulfilled' ? daysRead.value.days || [] : [],
    plates: platesRead.status === 'fulfilled' ? platesRead.value.plates || [] : [],
    forecast: forecast.items || [],
    basis: basisRead.status === 'fulfilled' ? basisRead.value.items || [] : [],
    receiptLocations:
      basisRead.status === 'fulfilled' ? basisRead.value.receiptLocations || [] : [],
    truncated: platesRead.status === 'fulfilled' ? Boolean(platesRead.value.truncated) : false,
    partial,
  };
}

// The Costos y márgenes screen's one read. Re-fetches when the range, merchant or
// location changes; the location is in `_deps` because two of the four reads are
// location-scoped and would otherwise answer from the previous branch.
// eslint-disable-next-line react-refresh/only-export-components
export function useInventoryCosting(rangeDays) {
  const ctx = useMerchant();
  return _useAsync(
    function () {
      return _loadInventoryCosting(ctx, rangeDays);
    },
    _deps(ctx, [String(Number(rangeDays) > 0 ? Number(rangeDays) : 28)]),
    EMPTY_COSTING,
  );
}

// ── Console inventory authoring: items, conversions and allergens ────────────
//
// The three reads behind `Catálogo e inventario → Inventario` (recipes module plan
// §7 and §11 Phase 1). They are gated by `merchant.manage` on the server, and the
// `catalog-inventory` module is opened by `catalog.read` OR `inventory.read`, so a
// cashier can reach the tab. A loader that fired anyway would answer with a 403 on
// every pass, so `_canManageInventory` keeps the request off the wire and the
// screen renders its own notice.
//
// `_deps` carries the permission because a capability set resolves after the first
// render: without it the loader would read the empty list the first pass produced
// and never ask again.
const EMPTY_INVENTORY_ITEMS = { items: [], page: null, correlationId: null, costedIds: [] };
const EMPTY_INVENTORY_CONVERSIONS = { items: [], page: null, correlationId: null };
const EMPTY_INVENTORY_ALLERGENS = { allergens: [], page: null, correlationId: null };

function _canManageInventory(ctx) {
  return hasRequiredPermission({ permissions: ['merchant.manage'] }, ctx?.capabilities);
}

// ⚠️ `includeItemsWithoutCost=false` is OMITTED, not sent. The query model coerces
// its booleans (`z.coerce.boolean()`), and `Boolean('false')` is TRUE, so sending
// the string would ask for the opposite of what it says. The default is false, so
// the second read asks the narrow question and the two answers together say which
// items no receipt has ever priced. The list marks those `Sin costo` instead of
// showing a zero the read never returned.
async function _loadInventoryItems(ctx, includeArchived) {
  const merchantId = _merchantId(ctx);
  if (!merchantId || !_canManageInventory(ctx)) return EMPTY_INVENTORY_ITEMS;
  const query = new URLSearchParams({ limit: '100' });
  if (includeArchived) query.set('includeArchived', 'true');
  const base = routes.inventory.items(merchantId);
  const [withCost, costedOnly] = await Promise.all([
    _apiFetch(`${base}?${query.toString()}&includeItemsWithoutCost=true`),
    _apiFetch(`${base}?${query.toString()}`),
  ]);
  return {
    items: (withCost && withCost.items) || [],
    page: (withCost && withCost.page) || null,
    correlationId: (withCost && withCost.correlationId) || null,
    costedIds: ((costedOnly && costedOnly.items) || []).map((item) => item.id),
  };
}

// eslint-disable-next-line react-refresh/only-export-components
export function useInventoryItems(options, refresh) {
  const ctx = useMerchant();
  const includeArchived = options?.includeArchived === true;
  return _useAsync(
    function () {
      return _loadInventoryItems(ctx, includeArchived);
    },
    _deps(ctx, [
      _canManageInventory(ctx) ? 'manage' : 'no-manage',
      includeArchived ? 'archived' : 'active',
      refresh || 0,
    ]),
    EMPTY_INVENTORY_ITEMS,
  );
}

// The flat conversion read. The item read already nests its own conversions, so
// this is the second answer: `inventory-workspace` merges them and the item's own
// list wins.
async function _loadInventoryUnitConversions(ctx) {
  const merchantId = _merchantId(ctx);
  if (!merchantId || !_canManageInventory(ctx)) return EMPTY_INVENTORY_CONVERSIONS;
  const response = await _apiFetch(`${routes.inventory.unitConversions(merchantId)}?limit=100`);
  return {
    items: (response && response.items) || [],
    page: (response && response.page) || null,
    correlationId: (response && response.correlationId) || null,
  };
}

// eslint-disable-next-line react-refresh/only-export-components
export function useInventoryUnitConversions(refresh) {
  const ctx = useMerchant();
  return _useAsync(
    function () {
      return _loadInventoryUnitConversions(ctx);
    },
    _deps(ctx, [_canManageInventory(ctx) ? 'manage' : 'no-manage', refresh || 0]),
    EMPTY_INVENTORY_CONVERSIONS,
  );
}

// The merchant's allergen labels. Inactive labels stay readable so the panel can
// switch them back on, which is what the `includeInactive` flag is for.
async function _loadInventoryAllergens(ctx) {
  const merchantId = _merchantId(ctx);
  if (!merchantId || !_canManageInventory(ctx)) return EMPTY_INVENTORY_ALLERGENS;
  const response = await _apiFetch(
    // 100 is the page cap the contract states (`InventoryAllergenQuery.limit` and
    // `PageInfo.limit` agree on it). Asking for 200 was refused with VALIDATION_FAILED,
    // and the refusal read as an empty label list on the screen.
    `${routes.inventory.allergens(merchantId)}?limit=100&includeInactive=true`,
  );
  return {
    allergens: (response && response.allergens) || [],
    page: (response && response.page) || null,
    correlationId: (response && response.correlationId) || null,
  };
}

// eslint-disable-next-line react-refresh/only-export-components
export function useInventoryAllergens(refresh) {
  const ctx = useMerchant();
  return _useAsync(
    function () {
      return _loadInventoryAllergens(ctx);
    },
    _deps(ctx, [_canManageInventory(ctx) ? 'manage' : 'no-manage', refresh || 0]),
    EMPTY_INVENTORY_ALLERGENS,
  );
}

// ── Console recipes: the Recetas tab (recipes module plan §7 and §11 Phase 2) ──
//
// Three reads behind `Catálogo e inventario → Recetas`, plus the explosion on
// demand for one recipe. All of them are gated on `merchant.manage` on the server,
// and the tab is reachable with `catalog.read` OR `inventory.read`, so the same
// `_canManageInventory` guard the item loaders use keeps a cashier's pass off the
// wire. A recipe that is being edited is read again after every save, because the
// server's answer is the cost the list shows.
const EMPTY_INVENTORY_RECIPES = { recipes: [], page: null, correlationId: null };

async function _loadInventoryRecipes(ctx, includeRetired) {
  const merchantId = _merchantId(ctx);
  if (!merchantId || !_canManageInventory(ctx)) return EMPTY_INVENTORY_RECIPES;
  // 100 is the page cap the contract states (`InventoryRecipeQuery.limit`). A café
  // with more recipes pages later; asking for more is refused as VALIDATION_FAILED,
  // and a refusal reads as an empty recipe list.
  const query = new URLSearchParams({ limit: '100' });
  if (includeRetired) query.set('includeRetired', 'true');
  const response = await _apiFetch(`${routes.inventory.recipes(merchantId)}?${query.toString()}`);
  return {
    recipes: (response && response.recipes) || [],
    page: (response && response.page) || null,
    correlationId: (response && response.correlationId) || null,
  };
}

// eslint-disable-next-line react-refresh/only-export-components
export function useInventoryRecipes(options, refresh) {
  const ctx = useMerchant();
  const includeRetired = options?.includeRetired === true;
  return _useAsync(
    function () {
      return _loadInventoryRecipes(ctx, includeRetired);
    },
    _deps(ctx, [
      _canManageInventory(ctx) ? 'manage' : 'no-manage',
      includeRetired ? 'retired' : 'active',
      refresh || 0,
    ]),
    EMPTY_INVENTORY_RECIPES,
  );
}

// One recipe exploded to its raw items. This is where the `exact` answer lives:
// `quantity` is floored and both costs are null when the rational does not divide
// at the item's scale, so the editor can say so instead of printing a rounded cost.
const EMPTY_RECIPE_EXPLOSION = {
  recipeId: null,
  targetKind: null,
  targetItemId: null,
  depth: 0,
  items: [],
};

async function _loadInventoryRecipeExplosion(ctx, recipeId) {
  const merchantId = _merchantId(ctx);
  if (!merchantId || !recipeId || !_canManageInventory(ctx)) return EMPTY_RECIPE_EXPLOSION;
  const response = await _apiFetch(routes.inventory.recipeExplosion(merchantId, recipeId));
  return Object.assign({}, EMPTY_RECIPE_EXPLOSION, response || {});
}

// eslint-disable-next-line react-refresh/only-export-components
export function useInventoryRecipeExplosion(recipeId, refresh) {
  const ctx = useMerchant();
  return _useAsync(
    function () {
      return _loadInventoryRecipeExplosion(ctx, recipeId);
    },
    _deps(ctx, [_canManageInventory(ctx) ? 'manage' : 'no-manage', recipeId || '', refresh || 0]),
    EMPTY_RECIPE_EXPLOSION,
  );
}

// The target picker's list: what a recipe can be built for, with the menu price the
// margin is measured against.
//
// ⚠️ THE MENU READ IS THE PLATE READ, AND THAT IS DELIBERATE. It is the only
// session-authenticated read that names a PRODUCT, a VARIANT and their price in one
// answer, and it is gated on `merchant.manage` rather than on `catalog.read`. The
// operations catalogue read is the alternative, and it needs a permission this tab
// does not require. Its limit is the read's own 200-plate cap.
//
// ⚠️ A KNOWN LIMIT. A variant appears when the catalogue already maps that variant.
// The console has no variant-catalogue read today, so a variant with no mapping
// cannot be chosen. A product-level target is always offered, because
// `includeUnmapped=true` lists every active product.
const EMPTY_RECIPE_TARGETS = { targets: [], truncated: false };

async function _loadRecipeTargets(ctx) {
  const merchantId = _merchantId(ctx);
  if (!merchantId || !_canManageInventory(ctx)) return EMPTY_RECIPE_TARGETS;
  const response = await _apiFetch(
    _merchantPath(ctx, '/inventory-costing/plates?includeUnmapped=true&limit=200'),
  );
  return {
    targets: ((response && response.plates) || []).map((plate) => ({
      productId: plate.productId,
      productName: plate.productName,
      productActive: plate.productActive,
      variantId: plate.variantId || null,
      variantName: plate.variantName || null,
      priceMinor: plate.priceMinor,
    })),
    truncated: Boolean(response && response.truncated),
  };
}

// eslint-disable-next-line react-refresh/only-export-components
export function useRecipeTargets(refresh) {
  const ctx = useMerchant();
  return _useAsync(
    function () {
      return _loadRecipeTargets(ctx);
    },
    _deps(ctx, [_canManageInventory(ctx) ? 'manage' : 'no-manage', refresh || 0]),
    EMPTY_RECIPE_TARGETS,
  );
}

// The cost basis of every item, including the ones no receipt has priced. The
// editor's live arithmetic needs it, and the four-read costing snapshot would be
// three reads of noise for this one table.
const EMPTY_INVENTORY_COST_BASIS = { items: [], receiptLocations: [], asOf: null };

async function _loadInventoryCostBasis(ctx) {
  const merchantId = _merchantId(ctx);
  if (!merchantId || !_canManageInventory(ctx)) return EMPTY_INVENTORY_COST_BASIS;
  const response = await _apiFetch(
    _merchantPath(ctx, '/inventory-costing/cost-basis?includeWithoutReceipts=true'),
  );
  return {
    items: (response && response.items) || [],
    receiptLocations: (response && response.receiptLocations) || [],
    asOf: (response && response.asOf) || null,
  };
}

// eslint-disable-next-line react-refresh/only-export-components
export function useInventoryCostBasis(refresh) {
  const ctx = useMerchant();
  return _useAsync(
    function () {
      return _loadInventoryCostBasis(ctx);
    },
    _deps(ctx, [_canManageInventory(ctx) ? 'manage' : 'no-manage', refresh || 0]),
    EMPTY_INVENTORY_COST_BASIS,
  );
}

// ── Console prep list and label sheet (recipes module plan §8.4, §8.3 and D14) ─
//
// The prep list read and the label sheet are gated on `merchant.manage` on the
// server, and the `catálogo e inventario` tab is reachable with `catalog.read`
// OR `inventory.read`, so the same `_canManageInventory` guard the item loaders
// use keeps a cashier's pass off the wire.
//
// The window (`from` / `to`) and the quantity come from the server, which owns
// the forecast (plan D13). The screen reads them, and it never recomputes them.
const EMPTY_PREP_LIST = {
  items: [],
  locationId: null,
  from: null,
  to: null,
  asOf: null,
  correlationId: null,
};

async function _loadPrepList(ctx, includeAbovePar) {
  const merchantId = _merchantId(ctx);
  if (!merchantId || !_canManageInventory(ctx)) return EMPTY_PREP_LIST;
  // `PrepListQuery.includeAbovePar` coerces its boolean, and `Boolean('false')`
  // is TRUE. The default is false, so the narrow question sends no parameter.
  const query = new URLSearchParams();
  if (includeAbovePar) query.set('includeAbovePar', 'true');
  const search = query.toString();
  const path = routes.inventory.prepList(merchantId) + (search ? `?${search}` : '');
  const response = await _apiFetch(_withLocation(ctx, path));
  return {
    items: (response && response.items) || [],
    locationId: (response && response.locationId) || null,
    from: (response && response.from) || null,
    to: (response && response.to) || null,
    asOf: (response && response.asOf) || null,
    correlationId: (response && response.correlationId) || null,
  };
}

// eslint-disable-next-line react-refresh/only-export-components
export function usePrepList(options, refresh) {
  const ctx = useMerchant();
  const includeAbovePar = options?.includeAbovePar === true;
  return _useAsync(
    function () {
      return _loadPrepList(ctx, includeAbovePar);
    },
    _deps(ctx, [
      _canManageInventory(ctx) ? 'manage' : 'no-manage',
      includeAbovePar ? 'above' : 'short',
      refresh || 0,
    ]),
    EMPTY_PREP_LIST,
  );
}

// The label sheet is a PNG the SERVER renders (plan D14), so it is fetched as a
// blob and saved. `_apiFetch` reads JSON, so this helper repeats that path's auth
// and its single session refresh, and returns the blob instead.
// eslint-disable-next-line react-refresh/only-export-components
export async function downloadPrepListLabels(merchantId, locationId) {
  const base = routes.inventory.prepListLabels(merchantId);
  const path = locationId ? `${base}?locationId=${encodeURIComponent(locationId)}` : base;
  const options = { headers: Object.assign({}, await getAuthHeaders()) };
  let res = await fetch(apiUrl(path), withCreds(options));
  if (res.status === 401 && COOKIE_AUTH) {
    const outcome = await refreshSession();
    if (outcome === REFRESH_OK) {
      const retryOptions = { headers: Object.assign({}, await getAuthHeaders()) };
      res = await fetch(apiUrl(path), withCreds(retryOptions));
    } else if (outcome === REFRESH_DEAD) {
      handleSessionExpired();
      const dead = new Error(t`Sesión expirada`);
      dead.status = 401;
      dead.code = 'session_expired';
      dead.path = path;
      throw dead;
    }
  }
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    const err = new Error(errMessage(payload, `${res.status} ${path}`));
    err.status = res.status;
    err.code =
      (payload && typeof payload.code === 'string' && payload.code) ||
      (payload && payload.error && typeof payload.error.code === 'string'
        ? payload.error.code
        : null) ||
      (payload && typeof payload.error === 'string' ? payload.error : null);
    err.path = path;
    err.details = payload;
    throw err;
  }
  return res.blob();
}

// ── Usage variance and menu engineering (recipes module plan 9.3, 9.5 and phase 4) ──
//
// The two reads behind the Variacion and Ingenieria de menu tabs of the Costos y
// margenes screen. Both are gated on `merchant.manage` on the server, and both take
// the window the costing read already resolved: a business date belongs to the
// cafe's timezone, so the browser never computes one.
//
// The variance read is BRANCH-SCOPED (its route carries a location context) and the
// menu read is not, so only the variance path is given the selected branch.
const EMPTY_USAGE_VARIANCE = {
  basis: null,
  lines: [],
  from: null,
  to: null,
  locationId: null,
  totalVarianceQuantity: null,
  totalUnexplainedQuantity: null,
  asOf: null,
  correlationId: null,
};

async function _loadUsageVariance(ctx, from, to) {
  const merchantId = _merchantId(ctx);
  if (!merchantId || !_canManageInventory(ctx) || !from || !to) return EMPTY_USAGE_VARIANCE;
  const query = new URLSearchParams({ from, to });
  const response = await _apiFetch(
    _withLocation(ctx, `${routes.inventory.usageVariance(merchantId)}?${query.toString()}`),
  );
  return {
    // The basis and the window are the answer's own words, and the screen prints
    // them instead of guessing what pool the numbers measure.
    basis: (response && response.basis) || null,
    lines: (response && response.lines) || [],
    from: (response && response.from) || null,
    to: (response && response.to) || null,
    locationId: (response && response.locationId) || null,
    totalVarianceQuantity: (response && response.totalVarianceQuantity) || null,
    totalUnexplainedQuantity: (response && response.totalUnexplainedQuantity) || null,
    asOf: (response && response.asOf) || null,
    correlationId: (response && response.correlationId) || null,
  };
}

// eslint-disable-next-line react-refresh/only-export-components
export function useInventoryUsageVariance(period, refresh) {
  const ctx = useMerchant();
  const from = (period && period.from) || null;
  const to = (period && period.to) || null;
  return _useAsync(
    function () {
      return _loadUsageVariance(ctx, from, to);
    },
    _deps(ctx, [
      _canManageInventory(ctx) ? 'manage' : 'no-manage',
      from || '',
      to || '',
      refresh || 0,
    ]),
    EMPTY_USAGE_VARIANCE,
  );
}

const EMPTY_MENU_ENGINEERING = {
  items: [],
  from: null,
  to: null,
  locationId: null,
  asOf: null,
  correlationId: null,
};

// `limit=100` is the widest page the house rule allows, and a menu is a list a
// person reads in one pass. The contract caps the read at 200; asking for less is
// always allowed.
async function _loadMenuEngineering(ctx, from, to) {
  const merchantId = _merchantId(ctx);
  if (!merchantId || !_canManageInventory(ctx) || !from || !to) return EMPTY_MENU_ENGINEERING;
  const query = new URLSearchParams({ from, to, limit: '100' });
  const response = await _apiFetch(
    `${routes.inventory.menuEngineering(merchantId)}?${query.toString()}`,
  );
  return {
    items: (response && response.items) || [],
    from: (response && response.from) || null,
    to: (response && response.to) || null,
    locationId: (response && response.locationId) || null,
    asOf: (response && response.asOf) || null,
    correlationId: (response && response.correlationId) || null,
  };
}

// eslint-disable-next-line react-refresh/only-export-components
export function useMenuEngineering(period, refresh) {
  const ctx = useMerchant();
  const from = (period && period.from) || null;
  const to = (period && period.to) || null;
  return _useAsync(
    function () {
      return _loadMenuEngineering(ctx, from, to);
    },
    _deps(ctx, [
      _canManageInventory(ctx) ? 'manage' : 'no-manage',
      from || '',
      to || '',
      refresh || 0,
    ]),
    EMPTY_MENU_ENGINEERING,
  );
}

// ── Supplier invoices: the Facturas tab (recipes module plan §7, §10 and §11 Phase 5) ──
//
// One loader for the whole inbox. It reads the invoice list, and it reads the OPEN
// purchase orders because `inventory.invoice.commit` needs the order and one of its
// lines per invoice line (plan §10.4). The two reads answer different questions and
// the order read is the one that can fail on its own, so the orders degrade to an
// empty list with `ordersFailed` set, and the invoice list still renders.
//
// The read is gated on `merchant.manage` on the server, and the tab is reachable
// with `catalog.read` or `inventory.read`, so the same `_canManageInventory` guard
// the item loaders use keeps a cashier's pass off the wire.
//
// `limit=100` is the widest page the contract allows (`SupplierInvoiceQuery.limit`
// and `PurchaseOrderQuery.limit` both cap at 100).
const EMPTY_SUPPLIER_INVOICE_INBOX = {
  invoices: [],
  page: null,
  correlationId: null,
  purchaseOrders: [],
  ordersFailed: false,
};

// The statuses an order still holds stock in transit for. The contract states the
// same pair (`OPEN_PURCHASE_ORDER_STATUSES`), and receiving against any other
// status is refused, so only these can carry a committed invoice.
const OPEN_PURCHASE_ORDER_STATUSES = ['sent', 'partially_received'];

async function _loadSupplierInvoiceInbox(ctx, status) {
  const merchantId = _merchantId(ctx);
  const locationId = _locationId(ctx);
  if (!merchantId || !_canManageInventory(ctx)) return EMPTY_SUPPLIER_INVOICE_INBOX;

  const invoiceQuery = new URLSearchParams({ limit: '100' });
  if (status) invoiceQuery.set('status', status);

  const ordersRead = locationId
    ? _apiFetch(
        `${buildPath('procurement.purchaseOrderList', { merchantId })}?${new URLSearchParams({
          locationId,
          limit: '100',
        }).toString()}`,
      ).then(
        (response) => ({
          ok: true,
          purchaseOrders: ((response && response.purchaseOrders) || []).filter((order) =>
            OPEN_PURCHASE_ORDER_STATUSES.includes(order && order.status),
          ),
        }),
        () => ({ ok: false, purchaseOrders: [] }),
      )
    : Promise.resolve({ ok: true, purchaseOrders: [] });

  const [invoicesRead, orders] = await Promise.all([
    _apiFetch(`${routes.supplierInvoices.list(merchantId)}?${invoiceQuery.toString()}`),
    ordersRead,
  ]);

  return {
    invoices: (invoicesRead && invoicesRead.invoices) || [],
    page: (invoicesRead && invoicesRead.page) || null,
    correlationId: (invoicesRead && invoicesRead.correlationId) || null,
    purchaseOrders: orders.purchaseOrders,
    ordersFailed: !orders.ok,
  };
}

// eslint-disable-next-line react-refresh/only-export-components
export function useSupplierInvoiceInbox(options, refresh) {
  const ctx = useMerchant();
  const status = (options && options.status) || null;
  return _useAsync(
    function () {
      return _loadSupplierInvoiceInbox(ctx, status);
    },
    _deps(ctx, [_canManageInventory(ctx) ? 'manage' : 'no-manage', status || '', refresh || 0]),
    EMPTY_SUPPLIER_INVOICE_INBOX,
  );
}

import { useState as useStateD, useEffect as useEffectD } from 'react'
import { LIVE as _LIVE, COOKIE_AUTH, apiUrl, withCreds, errMessage } from '@/lib/config.js'
import { getAuthHeaders, refreshSession, handleSessionExpired } from '@/lib/auth.jsx'
import { useTenant } from '@/lib/tenant-context.jsx'
import { isProductActive } from '@/lib/module-registry.js'

const EMPTY_OVERVIEW = {}
const EMPTY_STATIONS = []
const EMPTY_TICKER = []
const EMPTY_DEVICES = []
const EMPTY_STATIONS_KDS = []
const EMPTY_PAIRINGS = []
const EMPTY_TENANT = null
const EMPTY_ORDERS = []
const EMPTY_MEMBERS = { customers: [], total: 0, page: 1, totalPages: 1 }
const EMPTY_CUSTOMERS = { customers: [], total: 0, page: 1, totalPages: 1, source: null }
const EMPTY_CUSTOMER_DETAIL = { customer: null, timeline: [], conversations: [], orders: [], cash: null, identity: null }
const EMPTY_CUSTOMER_INSIGHTS = { metrics: {}, insights: [], source: null }
const EMPTY_STAFF = { staff: [] }
const EMPTY_HOURS = { hours: {}, timezone: null }
const EMPTY_VOICE = { voice: null, presets: [], businessName: '', defaults: null }
const EMPTY_GIFT_CARDS = { giftCards: [], total: 0, page: 1, totalPages: 1 }
const EMPTY_CONVERSATIONS = { conversations: [], total: 0, page: 1, totalPages: 1 }
const DEVICE_LIVE_MS = 10_000
const DEVICE_OFFLINE_MS = 20_000

function _tenantId(ctx) {
  return ctx?.selectedTenantId || ctx?.capabilities?.tenant?.id
}

function _locationId(ctx) {
  return ctx?.selectedLocationId || ctx?.capabilities?.selectedLocation?.id || ''
}

function _active(ctx, productKey) {
  return isProductActive(productKey, ctx?.capabilities)
}

function _withLocation(ctx, path) {
  const locationId = _locationId(ctx)
  if (!locationId) return path
  const sep = path.includes('?') ? '&' : '?'
  return `${path}${sep}locationId=${encodeURIComponent(locationId)}`
}

async function _apiFetch(path, opts, _retried) {
  opts = opts || {}
  const authHeaders = await getAuthHeaders()
  // Only advertise a JSON body when we actually send one. Fastify rejects an
  // empty body when Content-Type is application/json, so bodyless mutations
  // (pairing approve/deny, deletes) must NOT carry the header.
  const headers = Object.assign({}, authHeaders)
  if (opts.body != null) headers['Content-Type'] = 'application/json'
  const res = await fetch(apiUrl(path), withCreds(Object.assign({}, opts, {
    headers: Object.assign(headers, opts.headers || {}),
  })))

  // Cookie-mode session recovery: a 401 means the short-lived access cookie
  // expired. Refresh once (single-flight) and retry the request. If refresh
  // fails, the session is truly dead → clear it and bounce to /login.
  if (res.status === 401 && COOKIE_AUTH && !_retried && !path.includes('/api/auth/')) {
    const ok = await refreshSession()
    if (ok) return _apiFetch(path, opts, true)
    handleSessionExpired()
    const dead = new Error('Sesión expirada')
    dead.status = 401
    dead.code = 'session_expired'
    dead.path = path
    throw dead
  }

  const payload = await res.json().catch(() => ({}))
  if (!res.ok) {
    // Keep the human string on .message, but also surface the machine code and
    // HTTP status so callers can map to friendly copy and log the raw detail.
    const err = new Error(errMessage(payload, `${res.status} ${path}`))
    err.status = res.status
    err.code = payload && typeof payload.error === 'string' ? payload.error : null
    err.path = path
    throw err
  }
  return payload
}

function _tenantPath(ctx, suffix) {
  const tenantId = _tenantId(ctx)
  if (!tenantId) throw new Error('No active tenant selected')
  return `/api/tenants/${encodeURIComponent(tenantId)}${suffix}`
}

function _useAsync(asyncFn, deps, seed) {
  const [state, setState] = useStateD({ data: seed, loading: true, error: null })
  useEffectD(function() {
    var active = true
    setState(function(s) { return Object.assign({}, s, { loading: true, error: null }) })
    Promise.resolve().then(function() { return asyncFn() }).then(function(data) {
      if (active) setState({ data: data, loading: false, error: null })
    }).catch(function(err) {
      if (active) setState(function(s) { return Object.assign({}, s, { data: seed, loading: false, error: err.message }) })
    })
    return function() { active = false }
  }, deps)
  return state
}

function _deps(ctx, extra) {
  const products = ctx?.capabilities?.products || {}
  return [
    _tenantId(ctx) || '',
    _locationId(ctx) || '',
    products.cash?.status || '',
    products.kds?.status || '',
    products.conversaflow?.status || '',
    ...(extra || []),
  ]
}

function _deviceStatus(lastUsedAt) {
  if (!lastUsedAt) return 'offline'
  var ms = Date.now() - new Date(lastUsedAt).getTime()
  if (ms < DEVICE_LIVE_MS) return 'live'
  if (ms < DEVICE_OFFLINE_MS) return 'slow'
  return 'offline'
}

function _fmtLastSeen(lastUsedAt) {
  if (!lastUsedAt) return 'never'
  var ms = Date.now() - new Date(lastUsedAt).getTime()
  if (ms < 10000) return 'just now'
  if (ms < 60000) return Math.floor(ms / 1000) + ' s ago'
  if (ms < 3600000) return Math.floor(ms / 60000) + ' min ago'
  return Math.floor(ms / 3600000) + 'h ago'
}

async function _loadOverviewAndStations(ctx) {
  const cashResults = _active(ctx, 'cash')
    ? await Promise.allSettled([
        _apiFetch(_tenantPath(ctx, '/cash/stats')),
        _apiFetch(_tenantPath(ctx, '/cash/analytics')),
        _apiFetch(_tenantPath(ctx, '/cash/gift-cards?limit=100')),
      ])
    : []
  const kdsResults = _active(ctx, 'kds')
    ? await Promise.allSettled([
        _apiFetch(_withLocation(ctx, _tenantPath(ctx, '/kds/orders?filter=all'))),
        _apiFetch(_withLocation(ctx, _tenantPath(ctx, '/kds/devices'))),
        _apiFetch(_withLocation(ctx, _tenantPath(ctx, '/kds/ticker'))),
      ])
    : []

  const stats = cashResults[0]?.status === 'fulfilled' ? cashResults[0].value : null
  const analytics = cashResults[1]?.status === 'fulfilled' ? cashResults[1].value : null
  const giftCards = cashResults[2]?.status === 'fulfilled' ? (cashResults[2].value.giftCards || []) : []
  const orderPayload = kdsResults[0]?.status === 'fulfilled' ? kdsResults[0].value : null
  const devicePayload = kdsResults[1]?.status === 'fulfilled' ? kdsResults[1].value : null
  const tickerPayload = kdsResults[2]?.status === 'fulfilled' ? kdsResults[2].value : null

  const orders = orderPayload?.orders || []
  const devices = devicePayload?.devices || []
  const activeOrders = orders.filter(function(t) {
    return ['new', 'accepted', 'preparing', 'ready'].indexOf(t.status) !== -1
  })
  const completedOrders = orders.filter(function(t) { return t.status === 'completed' })
  const cancelledOrders = orders.filter(function(t) { return t.status === 'cancelled' })
  const totalAmount = orders.reduce(function(sum, t) { return sum + (parseFloat(t.total_amount) || 0) }, 0)

  const byStation = {}
  activeOrders.forEach(function(t) {
    const sid = t.station_id || 'unassigned'
    if (!byStation[sid]) byStation[sid] = { name: t.station_name || 'Unassigned', count: 0 }
    byStation[sid].count++
  })
  const devByStation = {}
  devices.forEach(function(d) { devByStation[d.station_id || 'unassigned'] = d.last_used_at })

  const stations = Object.keys(byStation).map(function(sid) {
    const lastAt = devByStation[sid] || null
    return {
      station_id: sid,
      station_name: byStation[sid].name,
      label: sid.toUpperCase(),
      status: _deviceStatus(lastAt),
      open: byStation[sid].count,
      foot: _fmtLastSeen(lastAt),
    }
  })

  const openGiftCards = giftCards.filter(function(card) { return !card.isRedeemed })

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
  }
}

async function _loadDevices(ctx) {
  if (!_active(ctx, 'kds')) return EMPTY_DEVICES
  // Heartbeat is now folded into GET /kds/devices server-side: umi-api derives
  // live/slow/offline from device.sessions.last_used_at, which the iPad's board
  // poll touches every cycle (Phase 4). The old separate `/api/kds/heartbeats`
  // call was a same-origin fetch that never reached umi-api in cookie mode — it
  // is removed (the "remove the duplicate" deliverable).
  const devResult = await _apiFetch(_withLocation(ctx, _tenantPath(ctx, '/kds/devices')))
  return (devResult.devices || []).map(function(d) {
    // `d.ip` overrides the merged default, so re-apply the '-' fallback after
    // the spread (the server sends null when no ip has been recorded yet).
    return Object.assign({ model: 'iPad' }, d, { ip: d.ip || '-' }, d.status ? {
      _heartbeatStatus: d.status,    // 'live' | 'slow' | 'offline'
      _heartbeatSeenMs: d.last_used_at ? new Date(d.last_used_at).getTime() : null,
    } : {})
  })
}

async function _loadKdsStations(ctx) {
  if (!_active(ctx, 'kds')) return EMPTY_STATIONS_KDS
  const result = await _apiFetch(_withLocation(ctx, _tenantPath(ctx, '/kds/stations')))
  return result.stations || []
}

async function _loadDevicePairings(ctx) {
  if (!_active(ctx, 'kds')) return EMPTY_PAIRINGS
  const result = await _apiFetch(_withLocation(ctx, _tenantPath(ctx, '/kds/devices/pairing')))
  return result.pairings || []
}

async function _loadTenant(ctx) {
  const s = await _apiFetch(_tenantPath(ctx, '/settings'))
  const cashSettings = _active(ctx, 'cash') && s?.slug
    ? await _apiFetch(`/api/${encodeURIComponent(s.slug)}/admin/settings`).catch(() => null)
    : null
  const rc = _active(ctx, 'cash')
    ? await _apiFetch(_tenantPath(ctx, '/cash/reward-config')).catch(() => null)
    : null
  if (!s) return null
  return {
    name: cashSettings?.name || s.name,
    city: cashSettings?.city || s.city,
    slug: cashSettings?.slug || s.slug,
    cardPrefix: cashSettings?.cardPrefix || s.cardPrefix || '',
    primaryColor: cashSettings?.primaryColor || s.primaryColor || '#B5605A',
    secondaryColor: cashSettings?.secondaryColor || s.secondaryColor || '#E8C9A3',
    logoUrl: cashSettings?.logoUrl || s.logoUrl || '',
    stripImageUrl: cashSettings?.stripImageUrl || s.stripImageUrl || '',
    passStyle: cashSettings?.passStyle || s.passStyle || 'stamps',
    subscriptionStatus: s.subscriptionStatus || 'ACTIVE',
    topupEnabled: s.topupEnabled,
    selfRegistration: cashSettings?.selfRegistration ?? s.selfRegistration,
    birthdayRewardEnabled: cashSettings?.birthdayRewardEnabled ?? s.birthdayRewardEnabled,
    birthdayRewardName: cashSettings?.birthdayRewardName ?? s.birthdayRewardName,
    promoMessage: cashSettings?.promoMessage || s.promoMessage || '',
    promoStartsAt: (cashSettings?.promoStartsAt || s.promoStartsAt) ? (cashSettings?.promoStartsAt || s.promoStartsAt).slice(0, 10) : '',
    promoEndsAt: (cashSettings?.promoEndsAt || s.promoEndsAt) ? (cashSettings?.promoEndsAt || s.promoEndsAt).slice(0, 10) : '',
    promoDays: cashSettings?.promoDays || s.promoDays || '',
    products: s.products || ctx?.capabilities?.products || {},
    locations: s.locations || ctx?.capabilities?.locations || [],
    rewardConfig: rc?.active ? {
      visitsRequired: rc.active.visitsRequired,
      rewardName: rc.active.rewardName,
      rewardCostCentavos: rc.active.rewardCostCentavos ?? 0,
      isActive: rc.active.isActive !== false,
    } : null,
  }
}

async function _loadOrders(ctx, filter) {
  if (!_active(ctx, 'kds')) return EMPTY_ORDERS
  const result = await _apiFetch(_withLocation(ctx, _tenantPath(ctx, '/kds/orders?filter=' + encodeURIComponent(filter || 'all'))))
  return (result.orders || []).map(function(t) {
    return Object.assign({ items_count: 0, items: [] }, t)
  })
}

async function _loadMembers(ctx, opts) {
  if (!_active(ctx, 'cash')) return EMPTY_MEMBERS
  opts = opts || {}
  const q = new URLSearchParams({
    page: String(opts.page || 1),
    limit: String(opts.limit || 20),
    sort: opts.sort || 'recent',
  })
  if (opts.search) q.set('search', opts.search)
  return _apiFetch(_tenantPath(ctx, '/cash/customers?' + q))
}

async function _loadCustomers(ctx, opts) {
  opts = opts || {}
  const q = new URLSearchParams({
    page: String(opts.page || 1),
    limit: String(opts.limit || 20),
  })
  if (opts.search) q.set('search', opts.search)
  if (opts.filter) q.set('filter', opts.filter)
  return _apiFetch(_tenantPath(ctx, '/customers?' + q))
}

async function _loadCustomerDetail(ctx, customerId) {
  if (!customerId) return EMPTY_CUSTOMER_DETAIL
  return _apiFetch(_tenantPath(ctx, '/customers/' + encodeURIComponent(customerId)))
}

async function _loadCustomerInsights(ctx) {
  return _apiFetch(_tenantPath(ctx, '/insights/customer-platform'))
}

async function _loadStaff(ctx) {
  return _apiFetch(_tenantPath(ctx, '/staff'))
}

async function _loadGiftCards(ctx, opts) {
  if (!_active(ctx, 'cash')) return EMPTY_GIFT_CARDS
  opts = opts || {}
  const q = new URLSearchParams({ page: String(opts.page || 1), limit: String(opts.limit || 20) })
  return _apiFetch(_tenantPath(ctx, '/cash/gift-cards?' + q))
}

async function _loadConversations(ctx, opts) {
  if (!_active(ctx, 'conversaflow')) return EMPTY_CONVERSATIONS
  opts = opts || {}
  const q = new URLSearchParams({ page: String(opts.page || 1), limit: String(opts.limit || 20) })
  return _apiFetch(_tenantPath(ctx, '/conversaflow/conversations?' + q))
}

async function _loadBusinessHours(ctx) {
  if (!_active(ctx, 'conversaflow')) return EMPTY_HOURS
  return _apiFetch(_withLocation(ctx, _tenantPath(ctx, '/conversaflow/hours')))
}

async function _loadVoiceConfig(ctx) {
  if (!_active(ctx, 'conversaflow')) return EMPTY_VOICE
  return _apiFetch(_tenantPath(ctx, '/conversaflow/voice'))
}

async function saveTenantSettings(patch) {
  const headers = await getAuthHeaders()
  const tenantId = window.localStorage.getItem('umi-dashboard-selected-tenant')
  if (!tenantId) throw new Error('No active tenant selected')
  return _apiFetch(`/api/tenants/${encodeURIComponent(tenantId)}/settings`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(patch),
  })
}

async function saveRewardConfig(patch) {
  const tenantId = window.localStorage.getItem('umi-dashboard-selected-tenant')
  if (!tenantId) throw new Error('No active tenant selected')
  return _apiFetch(`/api/tenants/${encodeURIComponent(tenantId)}/cash/reward-config`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
}

async function saveBusinessHours(hours, timezone) {
  const tenantId = window.localStorage.getItem('umi-dashboard-selected-tenant')
  const locationId = window.localStorage.getItem('umi-dashboard-selected-location')
  if (!tenantId) throw new Error('No active tenant selected')
  const path = `/api/tenants/${encodeURIComponent(tenantId)}/conversaflow/hours${locationId ? `?locationId=${encodeURIComponent(locationId)}` : ''}`
  return _apiFetch(path, {
    method: 'PATCH',
    body: JSON.stringify({ hours, timezone }),
  })
}

async function saveTenantVoice(patch) {
  const tenantId = window.localStorage.getItem('umi-dashboard-selected-tenant')
  if (!tenantId) throw new Error('No active tenant selected')
  return _apiFetch(`/api/tenants/${encodeURIComponent(tenantId)}/conversaflow/voice`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
}

async function createStaffMember(staff) {
  const tenantId = window.localStorage.getItem('umi-dashboard-selected-tenant')
  if (!tenantId) throw new Error('No active tenant selected')
  return _apiFetch(`/api/tenants/${encodeURIComponent(tenantId)}/staff`, {
    method: 'POST',
    body: JSON.stringify(staff),
  })
}

async function updateStaffMember(id, patch) {
  const tenantId = window.localStorage.getItem('umi-dashboard-selected-tenant')
  if (!tenantId) throw new Error('No active tenant selected')
  return _apiFetch(`/api/tenants/${encodeURIComponent(tenantId)}/staff/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
}

async function deleteStaffMember(id) {
  const tenantId = window.localStorage.getItem('umi-dashboard-selected-tenant')
  if (!tenantId) throw new Error('No active tenant selected')
  return _apiFetch(`/api/tenants/${encodeURIComponent(tenantId)}/staff/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}

// Build a tenant-scoped API path with the active location as `?locationId`.
// Centralizes the localStorage tenant/location lookup + missing-tenant guard
// that every KDS mutation shares.
function tenantScopedPath(basePath) {
  const tenantId = window.localStorage.getItem('umi-dashboard-selected-tenant')
  const locationId = window.localStorage.getItem('umi-dashboard-selected-location')
  if (!tenantId) throw new Error('No active tenant selected')
  return `/api/tenants/${encodeURIComponent(tenantId)}${basePath}${locationId ? `?locationId=${encodeURIComponent(locationId)}` : ''}`
}

async function provisionDevice(device) {
  return _apiFetch(tenantScopedPath('/kds/devices/provision'), {
    method: 'POST',
    body: JSON.stringify(device),
  })
}

async function generateDevicePairingPin(device) {
  return _apiFetch(tenantScopedPath('/kds/devices/pairing-pin'), {
    method: 'POST',
    body: JSON.stringify(device),
  })
}

async function createKdsStation(station) {
  return _apiFetch(tenantScopedPath('/kds/stations'), {
    method: 'POST',
    body: JSON.stringify(station),
  })
}

async function updateKdsStation(stationId, patch) {
  return _apiFetch(tenantScopedPath(`/kds/stations/${encodeURIComponent(stationId)}`), {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
}

async function deleteKdsStation(stationId) {
  return _apiFetch(tenantScopedPath(`/kds/stations/${encodeURIComponent(stationId)}`), { method: 'DELETE' })
}

async function approveDevicePairing(pairingId) {
  return _apiFetch(tenantScopedPath(`/kds/devices/pairing/${encodeURIComponent(pairingId)}/approve`), { method: 'POST' })
}

async function denyDevicePairing(pairingId) {
  return _apiFetch(tenantScopedPath(`/kds/devices/pairing/${encodeURIComponent(pairingId)}/deny`), { method: 'POST' })
}

async function updateDevice(deviceId, patch) {
  return _apiFetch(tenantScopedPath(`/kds/devices/${encodeURIComponent(deviceId)}`), {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
}

async function revokeDevice(deviceId, reason) {
  return _apiFetch(tenantScopedPath(`/kds/devices/${encodeURIComponent(deviceId)}/revoke`), {
    method: 'POST',
    body: JSON.stringify({ reason: reason || 'removed_from_dashboard' }),
  })
}

async function transitionOrder(ticketId, targetStatus, extra) {
  const tenantId = window.localStorage.getItem('umi-dashboard-selected-tenant')
  const locationId = window.localStorage.getItem('umi-dashboard-selected-location')
  if (!tenantId) throw new Error('No active tenant selected')
  const path = `/api/tenants/${encodeURIComponent(tenantId)}/kds/orders/${encodeURIComponent(ticketId)}/transition${locationId ? `?locationId=${encodeURIComponent(locationId)}` : ''}`
  return _apiFetch(path, {
    method: 'POST',
    body: JSON.stringify(Object.assign({ target_status: targetStatus }, extra || {})),
  })
}

function useOverviewData(refresh) {
  const ctx = useTenant()
  return _useAsync(function() { return _loadOverviewAndStations(ctx) }, _deps(ctx, [refresh]), { overview: EMPTY_OVERVIEW, stations: EMPTY_STATIONS, ticker: EMPTY_TICKER })
}

function useDevicesData(refresh) {
  const ctx = useTenant()
  return _useAsync(function() { return _loadDevices(ctx) }, _deps(ctx, [refresh]), EMPTY_DEVICES)
}

function useKdsStations(refresh) {
  const ctx = useTenant()
  return _useAsync(function() { return _loadKdsStations(ctx) }, _deps(ctx, [refresh || 0]), EMPTY_STATIONS_KDS)
}

function useDevicePairings(refresh) {
  const ctx = useTenant()
  return _useAsync(function() { return _loadDevicePairings(ctx) }, _deps(ctx, [refresh || 0]), EMPTY_PAIRINGS)
}

function useTenantData() {
  const ctx = useTenant()
  return _useAsync(function() { return _loadTenant(ctx) }, _deps(ctx), EMPTY_TENANT)
}

function useOrdersData(filter, refresh) {
  const ctx = useTenant()
  return _useAsync(function() { return _loadOrders(ctx, filter) }, _deps(ctx, [filter, refresh]), EMPTY_ORDERS)
}

function useStaffData(refresh) {
  const ctx = useTenant()
  return _useAsync(function() { return _loadStaff(ctx) }, _deps(ctx, [refresh || 0]), EMPTY_STAFF)
}

function useBusinessHours() {
  const ctx = useTenant()
  return _useAsync(function() { return _loadBusinessHours(ctx) }, _deps(ctx), EMPTY_HOURS)
}

function useVoiceConfig() {
  const ctx = useTenant()
  return _useAsync(function() { return _loadVoiceConfig(ctx) }, _deps(ctx), EMPTY_VOICE)
}

function useMembersData(opts) {
  const ctx = useTenant()
  var page = opts && opts.page ? opts.page : 1
  var search = opts && opts.search ? opts.search : ''
  var sort = opts && opts.sort ? opts.sort : 'recent'
  return _useAsync(function() {
    return _loadMembers(ctx, { page: page, search: search, sort: sort })
  }, _deps(ctx, [page, search, sort]), EMPTY_MEMBERS)
}

function useCustomersData(opts) {
  const ctx = useTenant()
  var page = opts && opts.page ? opts.page : 1
  var search = opts && opts.search ? opts.search : ''
  var filter = opts && opts.filter ? opts.filter : ''
  return _useAsync(function() {
    return _loadCustomers(ctx, { page: page, search: search, filter: filter })
  }, _deps(ctx, [page, search, filter]), EMPTY_CUSTOMERS)
}

function useCustomerDetail(customerId, refresh) {
  const ctx = useTenant()
  return _useAsync(function() {
    return _loadCustomerDetail(ctx, customerId)
  }, _deps(ctx, [customerId || '', refresh || 0]), EMPTY_CUSTOMER_DETAIL)
}

function useCustomerInsights(refresh) {
  const ctx = useTenant()
  return _useAsync(function() {
    return _loadCustomerInsights(ctx)
  }, _deps(ctx, [refresh || 0]), EMPTY_CUSTOMER_INSIGHTS)
}

function useGiftCardsData(opts) {
  const ctx = useTenant()
  var page = opts && opts.page ? opts.page : 1
  return _useAsync(function() { return _loadGiftCards(ctx, { page: page }) }, _deps(ctx, [page]), EMPTY_GIFT_CARDS)
}

function useConversationsData(opts) {
  const ctx = useTenant()
  var page = opts && opts.page ? opts.page : 1
  return _useAsync(function() { return _loadConversations(ctx, { page: page }) }, _deps(ctx, [page]), EMPTY_CONVERSATIONS)
}

// Polls /api/health and tracks connectivity to the dashboard backend.
// status: 'connecting' | 'online' | 'offline'
// Retries every 5 s while offline, every 20 s while online.
// retry() triggers an immediate re-check.
function useKdsConnection() {
  const [status,  setStatus]  = useStateD('connecting')
  const [latency, setLatency] = useStateD(null)
  const [seq,     setSeq]     = useStateD(0)  // bump to force immediate re-check

  useEffectD(function() {
    let cancelled = false

    async function check() {
      const t0 = Date.now()
      const ctrl = new AbortController()
      const timeout = setTimeout(() => ctrl.abort(), 5000)
      try {
        // umi-api exposes /health; server.js exposes /api/health.
        const res = await fetch(apiUrl(COOKIE_AUTH ? '/health' : '/api/health'), { cache: 'no-store', signal: ctrl.signal })
        clearTimeout(timeout)
        if (cancelled) return
        if (res.ok) {
          setStatus('online')
          setLatency(Date.now() - t0)
        } else {
          setStatus('offline')
          setLatency(null)
        }
      } catch {
        clearTimeout(timeout)
        if (!cancelled) { setStatus('offline'); setLatency(null) }
      }
    }

    check()
    const delay = status === 'offline' ? 5000 : 20000
    const id = setInterval(check, delay)
    return function() { cancelled = true; clearInterval(id) }
  }, [status, seq])

  return { status, latency, retry: function() { setSeq(function(s) { return s + 1 }) } }
}

export {
  useOverviewData, useDevicesData, useTenantData, useOrdersData,
  useKdsStations, useDevicePairings,
  useMembersData, useCustomersData, useCustomerDetail, useCustomerInsights,
  useStaffData, useBusinessHours, useVoiceConfig, useGiftCardsData, useConversationsData,
  saveTenantSettings, saveRewardConfig, saveBusinessHours, saveTenantVoice,
  createStaffMember, updateStaffMember, deleteStaffMember,
  provisionDevice, generateDevicePairingPin, approveDevicePairing, denyDevicePairing, updateDevice, revokeDevice, transitionOrder,
  createKdsStation, updateKdsStation, deleteKdsStation,
  useKdsConnection,
  _LIVE as DATA_IS_LIVE,
}

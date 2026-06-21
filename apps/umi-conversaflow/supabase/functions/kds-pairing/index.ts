import { getSupabaseClient } from '../_shared/supabase.ts'
import { slog } from '../_shared/logger.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-umi-user-id',
}

const PIN_TTL_MINUTES = 10
const POLL_AFTER_SECONDS = 5
const MAX_ATTEMPTS = 5

type Json = Record<string, unknown>

function json(body: Json, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function uuid(value: unknown): string | null {
  const input = text(value)
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input)
    ? input
    : null
}

function sixDigitPin(value: unknown): string | null {
  const input = text(value).replace(/\s+/g, '')
  return /^\d{6}$/.test(input) ? input : null
}

function randomHex(bytes: number): string {
  const data = new Uint8Array(bytes)
  crypto.getRandomValues(data)
  return Array.from(data, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function randomPin(): string {
  const max = 0xffffffff - (0xffffffff % 1_000_000)
  const data = new Uint32Array(1)
  do {
    crypto.getRandomValues(data)
  } while (data[0] >= max)
  return String(data[0] % 1_000_000).padStart(6, '0')
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function hashPin(pin: string, salt: string): Promise<string> {
  return sha256Hex(`${salt}:${pin}`)
}

async function loadStation(supabase: ReturnType<typeof getSupabaseClient>, tenantId: string, locationId: string | null, stationId: string) {
  let query = supabase
    .schema('kds')
    .from('stations')
    .select('id, tenant_id, location_id, name')
    .eq('id', stationId)
    .eq('tenant_id', tenantId)
    .eq('status', 'active')
    .limit(1)

  query = locationId ? query.eq('location_id', locationId) : query.is('location_id', null)

  const { data, error } = await query.maybeSingle()
  if (error) throw error
  return data
}

async function createDeviceSession(
  supabase: ReturnType<typeof getSupabaseClient>,
  pairing: Record<string, unknown>,
) {
  const token = randomHex(32)
  const tokenHash = await sha256Hex(token)
  const { data, error } = await supabase
    .schema('kds')
    .from('device_sessions')
    .insert({
      tenant_id: pairing.tenant_id,
      location_id: pairing.location_id ?? null,
      station_id: pairing.station_id,
      device_name: pairing.requested_name || pairing.device_name,
      token_hash: tokenHash,
      is_active: true,
    })
    .select('id, tenant_id, location_id, station_id, device_name')
    .single()

  if (error) throw error

  return { row: data, token }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  let body: Json
  try {
    body = await req.json()
  } catch {
    return json({ error: 'invalid_json' }, 400)
  }

  const action = text(body.action)
  if (!action) return json({ error: 'missing_action' }, 400)

  const supabase = getSupabaseClient()

  try {
    if (action === 'admin_create_pin') {
      const tenantId = uuid(body.tenant_id)
      const locationId = body.location_id == null || body.location_id === '' ? null : uuid(body.location_id)
      const stationId = uuid(body.station_id)
      const deviceName = text(body.device_name)
      if (!tenantId || !stationId || !deviceName) return json({ error: 'missing_required_fields' }, 400)
      if (body.location_id && !locationId) return json({ error: 'invalid_location_id' }, 400)

      const station = await loadStation(supabase, tenantId, locationId, stationId)
      if (!station) return json({ error: 'station_not_found' }, 404)

      const pin = randomPin()
      const pinSalt = randomHex(16)
      const pinHash = await hashPin(pin, pinSalt)
      const expiresAt = new Date(Date.now() + PIN_TTL_MINUTES * 60_000).toISOString()

      const { data, error } = await supabase
        .schema('kds')
        .from('device_pairing_requests')
        .insert({
          tenant_id: tenantId,
          location_id: locationId,
          station_id: stationId,
          device_name: deviceName,
          pin_hash: pinHash,
          pin_salt: pinSalt,
          status: 'pending',
          max_attempts: MAX_ATTEMPTS,
          expires_at: expiresAt,
        })
        .select('id, tenant_id, location_id, station_id, device_name, status, expires_at, created_at')
        .single()

      if (error) throw error
      return json({ pairing: { ...data, station_name: station.name, pin, poll_after_seconds: POLL_AFTER_SECONDS } }, 201)
    }

    if (action === 'admin_list') {
      const tenantId = uuid(body.tenant_id)
      const locationId = body.location_id == null || body.location_id === '' ? null : uuid(body.location_id)
      if (!tenantId) return json({ error: 'missing_tenant_id' }, 400)
      if (body.location_id && !locationId) return json({ error: 'invalid_location_id' }, 400)

      let query = supabase
        .schema('kds')
        .from('device_pairing_requests')
        .select('id, tenant_id, location_id, station_id, device_name, requested_name, status, attempt_count, max_attempts, expires_at, approved_by, approved_at, used_at, denied_at, created_at')
        .eq('tenant_id', tenantId)
        .in('status', ['pending', 'approved'])
        .order('created_at', { ascending: false })
        .limit(20)

      query = locationId ? query.eq('location_id', locationId) : query.is('location_id', null)

      const { data, error } = await query
      if (error) throw error
      return json({ pairings: data || [] })
    }

    if (action === 'admin_approve' || action === 'admin_deny') {
      const pairingId = uuid(body.pairing_id)
      const tenantId = uuid(body.tenant_id)
      const adminUserId = uuid(body.admin_user_id)
      if (!pairingId || !tenantId || (action === 'admin_approve' && !adminUserId)) {
        return json({ error: 'missing_required_fields' }, 400)
      }

      const patch = action === 'admin_approve'
        ? { status: 'approved', approved_by: adminUserId, approved_at: new Date().toISOString(), updated_at: new Date().toISOString() }
        : { status: 'denied', denied_at: new Date().toISOString(), updated_at: new Date().toISOString() }

      const { data, error } = await supabase
        .schema('kds')
        .from('device_pairing_requests')
        .update(patch)
        .eq('id', pairingId)
        .eq('tenant_id', tenantId)
        .eq('status', 'pending')
        .gt('expires_at', new Date().toISOString())
        .select('id, status')
        .maybeSingle()

      if (error) throw error
      if (!data) return json({ error: 'pairing_not_pending' }, 409)
      return json({ ok: true, pairing: data })
    }

    if (action === 'kds_start') {
      const pin = sixDigitPin(body.pin)
      const requestedName = text(body.device_name) || 'Kitchen iPad'
      if (!pin) return json({ error: 'invalid_pin' }, 400)

      const { data, error } = await supabase
        .schema('kds')
        .from('device_pairing_requests')
        .select('id, pin_hash, pin_salt, status, attempt_count, max_attempts, expires_at')
        .eq('status', 'pending')
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(50)

      if (error) throw error

      for (const pairing of data || []) {
        if (pairing.attempt_count >= pairing.max_attempts) continue
        if (await hashPin(pin, pairing.pin_salt) !== pairing.pin_hash) continue

        // PIN matched — only record the device name, do not touch attempt_count
        // (attempt_count tracks failed guesses; wrong PINs are rate-limited by TTL)
        const { error: updateError } = await supabase
          .schema('kds')
          .from('device_pairing_requests')
          .update({ requested_name: requestedName, updated_at: new Date().toISOString() })
          .eq('id', pairing.id)
          .eq('status', 'pending')

        if (updateError) throw updateError

        return json({
          pairing_id: pairing.id,
          status: 'pending',
          poll_after_seconds: POLL_AFTER_SECONDS,
          expires_at: pairing.expires_at,
        })
      }

      return json({ error: 'pairing_not_found' }, 404)
    }

    if (action === 'kds_status') {
      const pairingId = uuid(body.pairing_id)
      if (!pairingId) return json({ error: 'missing_pairing_id' }, 400)

      const { data: pairing, error } = await supabase
        .schema('kds')
        .from('device_pairing_requests')
        .select('id, tenant_id, location_id, station_id, device_name, requested_name, status, expires_at, used_at')
        .eq('id', pairingId)
        .maybeSingle()

      if (error) throw error
      if (!pairing) return json({ error: 'pairing_not_found' }, 404)

      if (pairing.status === 'pending' && new Date(pairing.expires_at).getTime() <= Date.now()) {
        await supabase
          .schema('kds')
          .from('device_pairing_requests')
          .update({ status: 'expired', updated_at: new Date().toISOString() })
          .eq('id', pairingId)
          .eq('status', 'pending')
        return json({ status: 'expired' })
      }

      if (pairing.status !== 'approved') {
        return json({ status: pairing.status, poll_after_seconds: pairing.status === 'pending' ? POLL_AFTER_SECONDS : undefined })
      }

      if (pairing.used_at) return json({ status: 'used' }, 409)

      const station = await loadStation(supabase, pairing.tenant_id, pairing.location_id ?? null, pairing.station_id)
      if (!station) return json({ error: 'station_not_found' }, 404)

      const session = await createDeviceSession(supabase, pairing)

      // Atomically mark as used; .is('used_at', null) guards against concurrent claims
      const { data: claimed, error: usedError } = await supabase
        .schema('kds')
        .from('device_pairing_requests')
        .update({ status: 'used', used_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', pairingId)
        .eq('status', 'approved')
        .is('used_at', null)
        .select('id')
        .maybeSingle()

      if (usedError) throw usedError
      if (!claimed) {
        // Another concurrent request already claimed this pairing; clean up the session we just created
        await supabase.schema('kds').from('device_sessions').delete().eq('id', session.row.id)
        return json({ status: 'used' }, 409)
      }

      return json({
        status: 'approved',
        device_session: {
          device_id: session.row.id,
          token: session.token,
          business_id: session.row.tenant_id,
          tenant_id: session.row.tenant_id,
          location_id: session.row.location_id,
          station_id: session.row.station_id,
          station_name: station.name,
          device_name: session.row.device_name,
        },
      })
    }

    return json({ error: 'unknown_action' }, 400)
  } catch (err) {
    const msg = err instanceof Error ? err.message : JSON.stringify(err)
    slog('error', 'kds_pairing_error', { action, error: msg })
    return json({ error: 'internal_error', detail: msg }, 500)
  }
})

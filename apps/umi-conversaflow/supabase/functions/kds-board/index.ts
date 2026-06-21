import { getSupabaseClient } from '../_shared/supabase.ts'
import { slog } from '../_shared/logger.ts'
import {
  KdsDeviceAuthError,
  kdsDeviceAuthJson,
  verifyKdsDeviceRequest,
} from '../_shared/kds-device-auth.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-kds-device-token',
}

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ error: 'invalid_json' }, 400)
  }

  const action = typeof body.action === 'string' ? body.action : ''
  if (!action) return json({ error: 'missing_action' }, 400)

  try {
    const deviceSession = await verifyKdsDeviceRequest(req)
    const supabase = getSupabaseClient()

    if (action === 'snapshot') {
      const { data, error } = await supabase
        .schema('kds')
        .rpc('get_board_snapshot', {
          p_business_id: deviceSession.businessId,
          p_station_id: deviceSession.stationId,
        })

      if (error) throw error
      return json({ ok: true, data: data || [] })
    }

    if (action === 'events') {
      const afterSequence = Number.isFinite(Number(body.after_sequence)) ? Number(body.after_sequence) : 0
      const limit = Number.isFinite(Number(body.limit)) ? Math.min(Math.max(Number(body.limit), 1), 500) : 200
      const { data, error } = await supabase
        .schema('kds')
        .rpc('get_ticket_events', {
          p_business_id: deviceSession.businessId,
          p_after_sequence: afterSequence,
          p_limit: limit,
        })

      if (error) throw error
      return json({ ok: true, data: data || [] })
    }

    if (action === 'session_status') {
      return json({ ok: true, device_id: deviceSession.deviceId })
    }

    return json({ error: 'unknown_action' }, 400)
  } catch (err) {
    if (err instanceof KdsDeviceAuthError) {
      return json(kdsDeviceAuthJson(err), err.status)
    }

    slog('error', 'kds_board_error', { action, error: String(err) })
    return json({ error: 'internal_error' }, 500)
  }
})

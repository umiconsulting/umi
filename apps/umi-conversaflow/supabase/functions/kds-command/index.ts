import { getSupabaseClient } from '../_shared/supabase.ts'
import { slog } from '../_shared/logger.ts'
import { triggerJobWorker } from '../_shared/workflow.ts'
import {
  KdsDeviceAuthError,
  kdsDeviceAuthJson,
  verifyKdsDeviceRequest,
} from '../_shared/kds-device-auth.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-kds-device-token',
}

type SupabaseClient = ReturnType<typeof getSupabaseClient>

async function loadTicketForDeviceScope(
  supabase: SupabaseClient,
  ticketId: string,
): Promise<Record<string, unknown> | null> {
  const byId = await supabase
    .schema('kds')
    .from('tickets')
    .select('*')
    .eq('id', ticketId)
    .limit(1)
    .maybeSingle()

  if (!byId.error) return byId.data

  const byTicketId = await supabase
    .schema('kds')
    .from('tickets')
    .select('*')
    .eq('ticket_id', ticketId)
    .limit(1)
    .maybeSingle()

  if (byTicketId.error) throw byTicketId.error
  return byTicketId.data
}

function ticketBelongsToDevice(
  ticket: Record<string, unknown> | null,
  deviceSession: { tenantId: string; businessId: string; locationId: string | null; stationId: string | null },
): boolean {
  if (!ticket) return false

  const ticketTenant = ticket.tenant_id == null ? null : String(ticket.tenant_id)
  const ticketBusiness = ticket.business_id == null ? null : String(ticket.business_id)
  const ticketLocation = ticket.location_id == null ? null : String(ticket.location_id)
  const ticketStation = ticket.station_id == null ? null : String(ticket.station_id)

  const tenantMatches = ticketTenant
    ? ticketTenant === deviceSession.tenantId
    : ticketBusiness === deviceSession.businessId

  const locationMatches = !deviceSession.locationId || ticketLocation === deviceSession.locationId
  const stationMatches = !deviceSession.stationId || ticketStation === deviceSession.stationId || ticketStation == null

  return tenantMatches && locationMatches && stationMatches
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'invalid_json' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const { action, actor_id, actor_channel } = body
  if (!action || typeof action !== 'string') {
    return new Response(JSON.stringify({ error: 'missing_action' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const supabase = getSupabaseClient()

  try {
    const deviceSession = await verifyKdsDeviceRequest(req)
    let result: unknown

    if (action === 'transition_ticket') {
      const { ticket_id, target_status, cancellation_reason_code, cancellation_reason_note } = body

      if (!ticket_id || typeof ticket_id !== 'string' || !target_status || typeof target_status !== 'string') {
        return new Response(JSON.stringify({ error: 'missing_required_fields' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const ticket = await loadTicketForDeviceScope(supabase, ticket_id)
      if (!ticketBelongsToDevice(ticket, deviceSession)) {
        return new Response(JSON.stringify({ error: 'ticket_not_found' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      // Always pass all 7 parameters to resolve the current overload unambiguously.
      const { data, error } = await supabase
        .schema('kds')
        .rpc('transition_ticket', {
          p_ticket_id: ticket_id,
          p_target_status: target_status,
          p_actor_source: 'kds_app',
          p_actor_id: deviceSession.deviceId || actor_id || null,
          p_actor_channel: deviceSession.stationId || actor_channel || null,
          p_cancellation_reason_code: cancellation_reason_code ?? null,
          p_cancellation_reason_note: cancellation_reason_note ?? null,
        })

      if (error) {
        slog('error', 'kds_command_transition_error', {
          ticket_id,
          target_status,
          error: error.message,
          code: error.code,
        })
        return new Response(JSON.stringify({ error: error.message }), {
          status: 422,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      result = data

    } else if (action === 'partial_cancel_items') {
      const { ticket_id, item_ids, reason_code, reason_note } = body

      if (
        !ticket_id || typeof ticket_id !== 'string' ||
        !Array.isArray(item_ids) || item_ids.length === 0 ||
        !reason_code || typeof reason_code !== 'string'
      ) {
        return new Response(JSON.stringify({ error: 'missing_required_fields' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const ticket = await loadTicketForDeviceScope(supabase, ticket_id)
      if (!ticketBelongsToDevice(ticket, deviceSession)) {
        return new Response(JSON.stringify({ error: 'ticket_not_found' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      // Always pass all 7 parameters to resolve the current overload unambiguously.
      const { data, error } = await supabase
        .schema('kds')
        .rpc('partial_cancel_items', {
          p_ticket_id: ticket_id,
          p_item_ids: item_ids,
          p_reason_code: reason_code,
          p_reason_note: reason_note ?? null,
          p_actor_source: 'kds_app',
          p_actor_id: deviceSession.deviceId || actor_id || null,
          p_actor_channel: deviceSession.stationId || actor_channel || null,
        })

      if (error) {
        slog('error', 'kds_command_partial_cancel_error', {
          ticket_id,
          item_count: item_ids.length,
          error: error.message,
          code: error.code,
        })
        return new Response(JSON.stringify({ error: error.message }), {
          status: 422,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      result = data

    } else {
      return new Response(JSON.stringify({ error: 'unknown_action' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Wake the job-worker immediately so outbox notifications don't wait for the cron heartbeat.
    await triggerJobWorker()

    slog('info', 'kds_command_ok', { action, device_id: deviceSession.deviceId })

    return new Response(JSON.stringify({ ok: true, data: result }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    if (err instanceof KdsDeviceAuthError) {
      return new Response(JSON.stringify(kdsDeviceAuthJson(err)), {
        status: err.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    slog('error', 'kds_command_error', { action, error: String(err) })
    return new Response(JSON.stringify({ error: 'internal_error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})

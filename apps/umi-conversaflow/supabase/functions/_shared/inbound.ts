import { slog } from './logger.ts'

export interface InboundEventRecord {
  business_id: string
  source: 'twilio'
  source_event_id?: string
  event_type: string
  payload: Record<string, unknown>
  request_id: string
}

/**
 * Insert an audit row into inbound_events.
 * - Silently ignores UNIQUE constraint violations (23505) — Twilio retries
 *   hitting the (source, source_event_id) unique index.
 * - Logs non-duplicate errors at warn level for monitoring.
 * - Never throws — caller should fire-and-forget.
 */
export async function recordInboundEvent(
  supabase: any,
  record: InboundEventRecord,
): Promise<void> {
  try {
    const { error } = await supabase.from('inbound_events').insert({
      business_id: record.business_id,
      source: record.source,
      source_event_id: record.source_event_id ?? null,
      event_type: record.event_type,
      payload: record.payload,
      status: 'accepted',
      request_id: record.request_id,
    })

    if (error) {
      // 23505 = unique_violation — duplicate source_event_id from retry/replay
      if (error.code === '23505') {
        slog('info', 'inbound_event_duplicate', {
          source: record.source,
          source_event_id: record.source_event_id,
          request_id: record.request_id,
        })
        return
      }
      slog('warn', 'inbound_event_insert_error', {
        source: record.source,
        error: error.message,
        code: error.code,
        request_id: record.request_id,
      })
    }
  } catch (err: any) {
    slog('warn', 'inbound_event_insert_failed', {
      source: record.source,
      error: err?.message,
      request_id: record.request_id,
    })
  }
}

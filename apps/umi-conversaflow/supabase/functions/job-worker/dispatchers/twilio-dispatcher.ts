import { sendWhatsAppMessage, sendLocationPin } from '../../_shared/adapters/twilio.ts'
import { slog, logPipelineTrace } from '../../_shared/logger.ts'

function toWhatsAppMarkdown(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, '*$1*')
}

/**
 * Dispatch a twilio.reply outbox row: send the assistant's WhatsApp reply to the customer.
 * Used by the conversation.process job processor (Step 8).
 */
export async function dispatchTwilioReply(_supabase: any, row: any): Promise<void> {
  const { to, body, trace_id, turn_id } = row.payload
  const result = await sendWhatsAppMessage({ to, body: toWhatsAppMarkdown(body) })
  if (!result) {
    throw new Error('Twilio sendWhatsAppMessage returned null — missing config or API error')
  }
  slog('info', 'twilio_reply_delivered', { outbox_id: row.id, sid: result.sid })
  if (trace_id) {
    await logPipelineTrace({
      trace_id,
      conversation_id: row.aggregate_id,
      turn_id: turn_id ?? undefined,
      stage: 'dispatch',
      event: 'delivered',
      detail: { outbox_id: row.id, sid: result.sid },
    })
  }
}

/**
 * Dispatch a twilio.status_notification outbox row: notify customer of order status change.
 */
export async function dispatchTwilioStatusNotification(_supabase: any, row: any): Promise<void> {
  const { to, body, trace_id, ticket_id, event_sequence, target_status, source_transaction_id } = row.payload
  const result = await sendWhatsAppMessage({ to, body: toWhatsAppMarkdown(body) })
  if (!result) {
    throw new Error('Twilio sendWhatsAppMessage returned null — missing config or API error')
  }
  slog('info', 'twilio_status_notification_delivered', {
    outbox_id: row.id,
    sid: result.sid,
    ticket_id: ticket_id ?? null,
    event_sequence: event_sequence ?? null,
    target_status: target_status ?? null,
    source_transaction_id: source_transaction_id ?? row.aggregate_id ?? null,
  })
  if (trace_id) {
    await logPipelineTrace({
      trace_id,
      conversation_id: undefined,
      turn_id: undefined,
      stage: 'dispatch',
      event: 'delivered',
      detail: {
        outbox_id: row.id,
        sid: result.sid,
        ticket_id: ticket_id ?? null,
        event_sequence: event_sequence ?? null,
        target_status: target_status ?? null,
        source_transaction_id: source_transaction_id ?? row.aggregate_id ?? null,
      },
    })
  }
}

/**
 * Dispatch a twilio.cancel_notification outbox row: notify customer of order cancellation.
 */
export async function dispatchTwilioCancelNotification(_supabase: any, row: any): Promise<void> {
  const { to, body } = row.payload
  const result = await sendWhatsAppMessage({ to, body: toWhatsAppMarkdown(body) })
  if (!result) {
    throw new Error('Twilio sendWhatsAppMessage returned null — missing config or API error')
  }
}

/**
 * Dispatch a twilio.location_pin outbox row: send business location pin to customer.
 */
export async function dispatchTwilioLocationPin(_supabase: any, row: any): Promise<void> {
  const { to, from, body, lat, lng, label } = row.payload
  const result = await sendLocationPin({ to, from, body, lat, lng, label })
  if (!result) {
    throw new Error('Twilio sendLocationPin returned null — missing config or API error')
  }
}

/**
 * Dispatch a whatsapp outbox row: send a cash lifecycle nudge (welcome, winback, streak, etc.).
 * Looks up the user's phone number from umi_cash schema.
 */
export async function dispatchWhatsAppLifecycle(supabase: any, row: any): Promise<void> {
  const { card_id, body, journey } = row.payload

  // Look up the user's phone from umi_cash
  const { data: card, error } = await supabase
    .schema('umi_cash')
    .from('LoyaltyCard')
    .select('user:User(phone)')
    .eq('id', card_id)
    .single()

  if (error || !card?.user?.phone) {
    throw new Error(`No phone found for card ${card_id}: ${error?.message || 'missing phone'}`)
  }

  const result = await sendWhatsAppMessage({ to: card.user.phone, body })
  if (!result) {
    throw new Error('Twilio sendWhatsAppMessage returned null — missing config or API error')
  }

  slog('info', 'whatsapp_lifecycle_delivered', {
    outbox_id: row.id,
    card_id,
    journey,
    sid: result.sid,
  })
}

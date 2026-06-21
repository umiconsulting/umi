import {
  dispatchTwilioReply,
  dispatchTwilioStatusNotification,
  dispatchTwilioCancelNotification,
  dispatchTwilioLocationPin,
  dispatchWhatsAppLifecycle,
} from './twilio-dispatcher.ts'

// Outbox dispatcher registry.
// Each dispatcher receives (supabase, outboxRow) and performs the external API call.

export type OutboxDispatcher = (supabase: any, row: any) => Promise<void>

export const DISPATCHERS: Record<string, OutboxDispatcher> = {
  // Twilio dispatchers
  'twilio.reply': dispatchTwilioReply,
  'twilio.status_notification': dispatchTwilioStatusNotification,
  'twilio.cancel_notification': dispatchTwilioCancelNotification,
  'twilio.location_pin': dispatchTwilioLocationPin,

  // Cash lifecycle WhatsApp dispatcher (S4.4)
  'whatsapp': dispatchWhatsAppLifecycle,
}

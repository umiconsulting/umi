import { slog } from '../logger.ts'

// ── Twilio REST API adapter ─────────────────────────────────────────────────
// Pure I/O: makes Twilio API calls. No Supabase, no domain logic.

const TWILIO_API = 'https://api.twilio.com/2010-04-01/Accounts'

function getTwilioConfig() {
  const accountSid = Deno.env.get('TWILIO_ACCOUNT_SID')
  const authToken = Deno.env.get('TWILIO_AUTH_TOKEN')
  const whatsappFrom = Deno.env.get('TWILIO_WHATSAPP_FROM')
  return { accountSid, authToken, whatsappFrom }
}

function buildAuthHeader(accountSid: string, authToken: string): string {
  return 'Basic ' + btoa(`${accountSid}:${authToken}`)
}

/**
 * Send a plain WhatsApp text message via Twilio REST API.
 * Returns the message SID on success, null on failure.
 */
export async function sendWhatsAppMessage(params: {
  to: string    // phone number without whatsapp: prefix
  body: string
  from?: string // whatsapp number without prefix; falls back to env TWILIO_WHATSAPP_FROM
  accountSid?: string
  authToken?: string
}): Promise<{ sid: string } | null> {
  const config = getTwilioConfig()
  const accountSid = params.accountSid ?? config.accountSid
  const authToken = params.authToken ?? config.authToken
  const from = params.from ?? config.whatsappFrom

  if (!accountSid || !authToken || !from) {
    slog('warn', 'twilio_adapter_missing_config', {
      has_account_sid: !!accountSid,
      has_auth_token: !!authToken,
      has_from: !!from,
    })
    return null
  }

  const url = `${TWILIO_API}/${accountSid}/Messages.json`
  const body = new URLSearchParams({
    From: `whatsapp:${from}`,
    To: `whatsapp:${params.to}`,
    Body: params.body,
  })

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: buildAuthHeader(accountSid, authToken),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    })

    if (!res.ok) {
      const text = await res.text()
      slog('error', 'twilio_send_failed', { status: res.status, error: text })
      return null
    }

    const data = await res.json()
    return { sid: data.sid }
  } catch (err) {
    slog('error', 'twilio_send_error', { error: String(err) })
    return null
  }
}

/**
 * Send a WhatsApp location pin via Twilio REST API (PersistentAction).
 * Used for sharing business location with customers.
 * Returns the message SID on success, null on failure.
 */
export async function sendLocationPin(params: {
  to: string        // phone number without whatsapp: prefix
  from: string      // already has whatsapp: prefix (e.g. from Twilio webhook 'To' param)
  body: string
  lat: number
  lng: number
  label: string
  accountSid?: string
  authToken?: string
}): Promise<{ sid: string } | null> {
  const config = getTwilioConfig()
  const accountSid = params.accountSid ?? config.accountSid
  const authToken = params.authToken ?? config.authToken

  if (!accountSid || !authToken) {
    slog('warn', 'twilio_adapter_missing_config', {
      has_account_sid: !!accountSid,
      has_auth_token: !!authToken,
    })
    return null
  }

  const url = `${TWILIO_API}/${accountSid}/Messages.json`
  const body = new URLSearchParams({
    From: params.from,
    To: `whatsapp:${params.to}`,
    Body: params.body,
    PersistentAction: `geo:${params.lat},${params.lng}|${params.label}`,
  })

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: buildAuthHeader(accountSid, authToken),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    })

    if (!res.ok) {
      const text = await res.text()
      slog('error', 'twilio_location_pin_failed', { status: res.status, error: text })
      return null
    }

    const data = await res.json()
    return { sid: data.sid }
  } catch (err) {
    slog('error', 'twilio_location_pin_error', { error: String(err) })
    return null
  }
}

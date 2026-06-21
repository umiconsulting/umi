const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID ?? ''
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN ?? ''

const BASE = 'https://api.twilio.com'
const MONITOR_BASE = 'https://monitor.twilio.com'

function isConfigured() {
  return !!(
    ACCOUNT_SID &&
    AUTH_TOKEN &&
    !ACCOUNT_SID.startsWith('your-') &&
    !AUTH_TOKEN.startsWith('your-')
  )
}

function getAuthHeader(): Record<string, string> {
  const encoded = Buffer.from(`${ACCOUNT_SID}:${AUTH_TOKEN}`).toString('base64')
  return { Authorization: `Basic ${encoded}` }
}

// ── Types ──────────────────────────────────────────────────────────────────

export interface TwilioMessage {
  sid: string
  from: string
  to: string
  body: string
  status: string
  direction: string
  date_sent: string | null
  date_created: string
  date_updated: string
  num_segments: string
  price: string | null
  price_unit: string | null
  error_code: number | null
  error_message: string | null
}

export interface TwilioAlert {
  sid: string
  error_code: string
  log_level: string
  alert_text: string
  request_url: string | null
  request_method: string | null
  date_created: string
  date_generated: string
  resource_sid: string | null
  service_sid: string | null
}

export interface TwilioMessageSummary {
  messages: TwilioMessage[]
  total: number
  inbound: number
  outbound: number
  byStatus: Record<string, number>
  failed: TwilioMessage[]
  totalCostUsd: number
}

// ── Fetchers ───────────────────────────────────────────────────────────────

export async function fetchTwilioMessages(days = 7): Promise<TwilioMessageSummary | null> {
  if (!isConfigured()) return null

  const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10)

  const headers = getAuthHeader()
  const messages: TwilioMessage[] = []

  // DateSent>= is a literal query param name in Twilio's API
  let nextUrl: string | null =
    `${BASE}/2010-04-01/Accounts/${ACCOUNT_SID}/Messages.json?DateSent>=${startDate}&PageSize=1000`

  let pages = 0
  const MAX_PAGES = 3

  while (nextUrl && pages < MAX_PAGES) {
    const res: Response = await fetch(nextUrl, {
      headers,
      next: { revalidate: 60 },
    })
    if (!res.ok) {
      console.error('[twilioApi] messages fetch error:', res.status, await res.text())
      break
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const json = await res.json() as any
    const raw: TwilioMessage[] = json.messages ?? []
    messages.push(...raw)
    nextUrl = json.next_page_uri ? `${BASE}${json.next_page_uri}` : null
    pages++
  }

  const byStatus: Record<string, number> = {}
  let inbound = 0
  let outbound = 0
  let totalCostUsd = 0

  for (const m of messages) {
    byStatus[m.status] = (byStatus[m.status] ?? 0) + 1
    if (m.direction === 'inbound') inbound++
    else outbound++
    if (m.price) totalCostUsd += Math.abs(parseFloat(m.price))
  }

  const failed = messages.filter(
    (m) => m.status === 'failed' || m.status === 'undelivered'
  )

  return { messages, total: messages.length, inbound, outbound, byStatus, failed, totalCostUsd }
}

export async function fetchTwilioAlerts(days = 7): Promise<TwilioAlert[]> {
  if (!isConfigured()) return []

  const startDate = new Date(
    Date.now() - Math.min(days, 30) * 24 * 60 * 60 * 1000
  ).toISOString()

  const params = new URLSearchParams({ startDate, pageSize: '100' })

  const res = await fetch(`${MONITOR_BASE}/v1/Alerts?${params}`, {
    headers: getAuthHeader(),
    next: { revalidate: 120 },
  })

  if (!res.ok) {
    console.error('[twilioApi] alerts fetch error:', res.status, await res.text())
    return []
  }

  const json = await res.json()
  return (json.alerts ?? []) as TwilioAlert[]
}

import * as https from 'node:https'

const BASE_HOST = 'api.anthropic.com'

// Native https avoids undici's HTTP/2 ALPN which causes UND_ERR_SOCKET on
// the Admin API endpoints (/v1/organizations/...) that only accept HTTP/1.1.
function httpsGet(path: string, headers: Record<string, string>): Promise<{ status: number; text: () => string }> {
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname: BASE_HOST, path, method: 'GET', headers, timeout: 300000 }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8')
        resolve({ status: res.statusCode ?? 0, text: () => body })
      })
    })
    req.on('timeout', () => { req.destroy(new Error('Admin API request timed out (5m) — endpoint may be slow or network-restricted')) })
    req.on('error', reject)
    req.end()
  })
}

function getKey() {
  return process.env.ANTHROPIC_ADMIN_KEY ?? ''
}

function isConfigured() {
  const key = getKey()
  return key && !key.startsWith('your-')
}

function getHeaders() {
  return {
    'x-api-key': getKey(),
    'anthropic-version': '2023-06-01',
  }
}

// ── Types ──────────────────────────────────────────────────────────────────

export interface UsageBucket {
  date: string       // YYYY-MM-DD (from starting_at)
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_creation_tokens: number
  total_tokens: number
}

export interface CostBucket {
  date: string       // YYYY-MM-DD
  cost_usd: number   // converted from cents
}

export interface AnthropicSummary {
  dailyUsage: UsageBucket[]
  dailyCost: CostBucket[]
  totalCostUsd: number
  totalInputTokens: number
  totalOutputTokens: number
  totalCacheReadTokens: number
  totalCacheCreationTokens: number
}

// ── Result type ────────────────────────────────────────────────────────────

export type AnthropicResult =
  | { status: 'ok'; data: AnthropicSummary }
  | { status: 'no_key' }
  | { status: 'network_error'; message: string }
  | { status: 'auth_error' }
  | { status: 'api_error'; httpStatus: number }

// ── Fetchers ───────────────────────────────────────────────────────────────

export async function fetchAnthropicUsage(days = 30): Promise<AnthropicResult> {
  if (!isConfigured()) return { status: 'no_key' }

  // Docs require midnight UTC boundaries (T00:00:00Z) for daily buckets.
  // Sending mid-day timestamps (e.g. T15:30:00.000Z) causes 500s because the
  // server must compute a partial-day bucket for the current hour.
  const toMidnightUTC = (d: Date) => {
    d.setUTCHours(0, 0, 0, 0)
    return d.toISOString().replace('.000Z', 'Z')  // "2026-01-27T00:00:00Z"
  }
  const ending_at = toMidnightUTC(new Date())
  const starting_at = toMidnightUTC(new Date(Date.now() - days * 24 * 60 * 60 * 1000))

  const usageParams = new URLSearchParams({
    starting_at,
    ending_at,
    bucket_width: '1d',
    limit: String(Math.min(days, 31)),
  })

  const costParams = new URLSearchParams({
    starting_at,
    ending_at,
    bucket_width: '1d',
    limit: String(Math.min(days, 31)),
  })

  const headers = getHeaders()

  let usageRes: { status: number; text: () => string }
  let costRes: { status: number; text: () => string }
  try {
    ;[usageRes, costRes] = await Promise.all([
      httpsGet(`/v1/organizations/usage_report/messages?${usageParams}`, headers),
      httpsGet(`/v1/organizations/cost_report?${costParams}`, headers),
    ])
  } catch (err) {
    console.error('[anthropicApi] network error:', err)
    return { status: 'network_error', message: String(err) }
  }

  // Auth errors are always hard failures
  if (usageRes.status === 401 || usageRes.status === 403 ||
      costRes.status === 401 || costRes.status === 403) {
    console.error('[anthropicApi] auth error — usage:', usageRes.status, 'cost:', costRes.status)
    return { status: 'auth_error' }
  }

  // Hard fail only if the usage endpoint errors (cost is less critical)
  if (usageRes.status >= 400) {
    console.error('[anthropicApi] usage_report error:', usageRes.status, usageRes.text())
    return { status: 'api_error', httpStatus: usageRes.status }
  }

  // Cost endpoint 5xx → degrade gracefully (show usage, skip official cost)
  if (costRes.status >= 400) {
    console.error('[anthropicApi] cost_report error (degraded — cost data omitted):', costRes.status, costRes.text())
  }

  const usageJson = JSON.parse(usageRes.text())
  const costJson = costRes.status < 400 ? JSON.parse(costRes.text()) : { data: [] }

  // Parse usage: each bucket has results[] (ungrouped → single result)
  const dailyUsage: UsageBucket[] = (usageJson.data ?? []).map((bucket: {
    starting_at: string
    results: Array<{
      uncached_input_tokens: number
      output_tokens: number
      cache_read_input_tokens: number
      cache_creation?: { ephemeral_1h_input_tokens: number; ephemeral_5m_input_tokens: number }
    }>
  }) => {
    const r = bucket.results[0] ?? {}
    const cache_creation =
      (r.cache_creation?.ephemeral_1h_input_tokens ?? 0) +
      (r.cache_creation?.ephemeral_5m_input_tokens ?? 0)
    return {
      date: bucket.starting_at.slice(0, 10),
      input_tokens: r.uncached_input_tokens ?? 0,
      output_tokens: r.output_tokens ?? 0,
      cache_read_tokens: r.cache_read_input_tokens ?? 0,
      cache_creation_tokens: cache_creation,
      total_tokens:
        (r.uncached_input_tokens ?? 0) +
        (r.output_tokens ?? 0) +
        (r.cache_read_input_tokens ?? 0) +
        cache_creation,
    }
  })

  // Parse cost: amount is in cents (e.g. "123.45" = $1.2345)
  const dailyCost: CostBucket[] = (costJson.data ?? []).map((bucket: {
    starting_at: string
    results: Array<{ amount: string; currency: string }>
  }) => {
    const totalCents = (bucket.results ?? []).reduce(
      (s: number, r: { amount: string }) => s + parseFloat(r.amount),
      0
    )
    return {
      date: bucket.starting_at.slice(0, 10),
      cost_usd: totalCents / 100,
    }
  })

  const totalCostUsd = dailyCost.reduce((s, b) => s + b.cost_usd, 0)
  const totalInputTokens = dailyUsage.reduce((s, b) => s + b.input_tokens, 0)
  const totalOutputTokens = dailyUsage.reduce((s, b) => s + b.output_tokens, 0)
  const totalCacheReadTokens = dailyUsage.reduce((s, b) => s + b.cache_read_tokens, 0)
  const totalCacheCreationTokens = dailyUsage.reduce((s, b) => s + b.cache_creation_tokens, 0)

  return {
    status: 'ok',
    data: {
      dailyUsage,
      dailyCost,
      totalCostUsd,
      totalInputTokens,
      totalOutputTokens,
      totalCacheReadTokens,
      totalCacheCreationTokens,
    },
  }
}

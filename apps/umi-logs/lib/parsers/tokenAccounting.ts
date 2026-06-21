// Token pricing constants for Claude models (USD per million tokens)
// Source: Anthropic pricing as of 2025
const MODEL_PRICING: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  'claude-haiku-4-5':        { input: 0.80,  output: 4.00,  cacheRead: 0.08,  cacheWrite: 1.00 },
  'claude-haiku-4-5-20251001': { input: 0.80, output: 4.00, cacheRead: 0.08,  cacheWrite: 1.00 },
  'claude-sonnet-4-5':       { input: 3.00,  output: 15.00, cacheRead: 0.30,  cacheWrite: 3.75 },
  'claude-sonnet-4-6':       { input: 3.00,  output: 15.00, cacheRead: 0.30,  cacheWrite: 3.75 },
  'claude-opus-4-6':         { input: 15.00, output: 75.00, cacheRead: 1.50,  cacheWrite: 18.75 },
  // fallback
  default:                   { input: 0.80,  output: 4.00,  cacheRead: 0.08,  cacheWrite: 1.00 },
}

export interface TokenCounts {
  input: number
  output: number
  cacheRead: number
  cacheCreation: number
}

export interface RequestCost {
  input_usd: number
  output_usd: number
  cache_usd: number
  total_usd: number
}

function getPricing(model: string) {
  return MODEL_PRICING[model] ?? MODEL_PRICING.default
}

export function computeRequestCost(tokens: TokenCounts, model = 'claude-haiku-4-5'): RequestCost {
  const p = getPricing(model)
  const M = 1_000_000
  const input_usd = (tokens.input / M) * p.input
  const output_usd = (tokens.output / M) * p.output
  const cache_usd =
    (tokens.cacheRead / M) * p.cacheRead +
    (tokens.cacheCreation / M) * p.cacheWrite
  return {
    input_usd,
    output_usd,
    cache_usd,
    total_usd: input_usd + output_usd + cache_usd,
  }
}

/**
 * Format token counts as a compact string, e.g. "1.2k in · 340 out"
 */
export function formatTokenCounts(counts: TokenCounts): string {
  function fmt(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
    return String(n)
  }
  const parts = [
    `${fmt(counts.input)} in`,
    `${fmt(counts.output)} out`,
  ]
  if (counts.cacheRead > 0) parts.push(`${fmt(counts.cacheRead)} cache`)
  return parts.join(' · ')
}

export function formatCost(usd: number): string {
  if (usd < 0.0001) return `$${usd.toFixed(6)}`
  if (usd < 0.01) return `$${usd.toFixed(5)}`
  return `$${usd.toFixed(4)}`
}

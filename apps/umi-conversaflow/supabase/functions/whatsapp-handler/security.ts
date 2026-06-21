import { BUSINESS_ID } from '../_shared/cors.ts'

export const SECURITY_CONFIG = {
  MAX_MESSAGE_LENGTH: 500,
  MAX_MESSAGES_PER_MINUTE: 10,
  MAX_MESSAGES_PER_HOUR: 50,
  // SEC-02: Structural injection patterns only — no broad keyword matching
  // that would false-positive on legitimate Spanish café vocabulary.
  SUSPICIOUS_PATTERNS: [
    /ignore\s+previous\s+instructions/i,
    /disregard\s+all\s+previous/i,
    /forget\s+everything/i,
    /\[INST\]/i,
    /<\|im_start\|>/i,
    /\{\{.*prompt.*\}\}/i,
    /<script/i,
    /javascript:/i,
    /on\w+\s*=/i,
    // Direct role-injection patterns
    /^\s*(system|assistant)\s*:/im,
    // Common jailbreak templates
    /\bDAN\b.*mode/i,
    /jailbreak/i,
  ],
}

export function detectPromptInjection(message: string): { detected: boolean; pattern?: string } {
  for (const pattern of SECURITY_CONFIG.SUSPICIOUS_PATTERNS) {
    if (pattern.test(message)) {
      return { detected: true, pattern: pattern.toString() }
    }
  }
  return { detected: false }
}

export function sanitizeInput(input: string | undefined | null): string {
  const sanitized = (input ?? '')
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+\s*=/gi, '')
    .replace(/\{\{.*?\}\}/g, '')
    .replace(/<\|.*?\|>/g, '')
    .replace(/\[INST\]/gi, '')
    .replace(/\[\/INST\]/gi, '')

  return sanitized.trim().substring(0, SECURITY_CONFIG.MAX_MESSAGE_LENGTH)
}

export function sanitizeOutput(output: string): string {
  return output
    .replace(/ANTHROPIC_API_KEY/gi, '[REDACTED]')
    .replace(/SUPABASE.*KEY/gi, '[REDACTED]')
    .replace(/Bearer\s+[A-Za-z0-9\-._~+\/]+=*/gi, '[REDACTED]')
    // Strip transcript-continuation hallucinations: lines starting with "user:" or "assistant:"
    .replace(/\n(user|assistant|cliente|asistente):\s*.*/gi, '')
    .trim()
}

export function validateOrderItems(items: any[]): { valid: boolean; reason?: string } {
  if (!Array.isArray(items) || items.length === 0) {
    return { valid: false, reason: 'No hay items en la orden' }
  }
  if (items.length > 20) {
    return { valid: false, reason: 'Demasiados items (máximo 20)' }
  }

  for (const item of items) {
    if (!item.product_name || typeof item.product_name !== 'string' || item.product_name.trim().length === 0) {
      return { valid: false, reason: 'Nombre de producto inválido' }
    }
    if (!item.quantity || typeof item.quantity !== 'number' || item.quantity < 1 || item.quantity > 50) {
      return { valid: false, reason: 'Cantidad inválida (1-50)' }
    }
  }

  return { valid: true }
}

export function validateCartItems(cart: any): { valid: boolean; reason?: string } {
  if (cart == null) return { valid: true }
  if (typeof cart !== 'object' || Array.isArray(cart)) {
    return { valid: false, reason: 'draft_cart debe ser un objeto' }
  }

  const items = (cart as any).items
  const updatedAt = (cart as any).updated_at
  const customerNote = (cart as any).customer_note

  if (!Array.isArray(items)) {
    return { valid: false, reason: 'draft_cart.items debe ser un arreglo' }
  }
  if (typeof updatedAt !== 'string' || Number.isNaN(Date.parse(updatedAt))) {
    return { valid: false, reason: 'draft_cart.updated_at inválido' }
  }
  if (customerNote != null && typeof customerNote !== 'string') {
    return { valid: false, reason: 'draft_cart.customer_note inválido' }
  }
  if (items.length > 50) {
    return { valid: false, reason: 'draft_cart tiene demasiados items' }
  }

  for (const item of items) {
    if (!item || typeof item !== 'object') {
      return { valid: false, reason: 'Item de carrito inválido' }
    }
    if (typeof item.product_id !== 'string' || item.product_id.trim().length === 0) {
      return { valid: false, reason: 'product_id inválido' }
    }
    if (typeof item.product_name !== 'string' || item.product_name.trim().length === 0) {
      return { valid: false, reason: 'product_name inválido' }
    }
    if (item.variant_name != null && typeof item.variant_name !== 'string') {
      return { valid: false, reason: 'variant_name inválido' }
    }
    if (typeof item.quantity !== 'number' || item.quantity < 1 || item.quantity > 50) {
      return { valid: false, reason: 'quantity inválido' }
    }
    if (typeof item.unit_price !== 'number' || !Number.isFinite(item.unit_price) || item.unit_price < 0) {
      return { valid: false, reason: 'unit_price inválido' }
    }
  }

  return { valid: true }
}

export async function checkRateLimit(
  supabase: any,
  phone: string,
): Promise<{ allowed: boolean; count: number }> {
  const now = new Date()
  const oneMinuteAgo = new Date(now.getTime() - 60 * 1000)
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000)

  const { data: customer } = await supabase
    .from('customers')
    .select('id')
    .eq('phone', phone)
    .eq('business_id', BUSINESS_ID)
    .maybeSingle()

  if (!customer) return { allowed: true, count: 0 }

  const { data: conversation } = await supabase
    .from('conversations')
    .select('id')
    .eq('customer_id', customer.id)
    .eq('status', 'active')
    .gte('last_message_at', oneHourAgo.toISOString())
    .maybeSingle()

  if (!conversation) return { allowed: true, count: 0 }

  const [minuteResult, hourResult] = await Promise.all([
    supabase
      .from('messages')
      .select('*', { count: 'exact', head: true })
      .eq('conversation_id', conversation.id)
      .eq('role', 'user')
      .gte('created_at', oneMinuteAgo.toISOString()),
    supabase
      .from('messages')
      .select('*', { count: 'exact', head: true })
      .eq('conversation_id', conversation.id)
      .eq('role', 'user')
      .gte('created_at', oneHourAgo.toISOString()),
  ])

  const messagesLastMinute = minuteResult.count ?? 0
  const messagesLastHour = hourResult.count ?? 0

  if (messagesLastMinute >= SECURITY_CONFIG.MAX_MESSAGES_PER_MINUTE) {
    return { allowed: false, count: messagesLastMinute }
  }
  if (messagesLastHour >= SECURITY_CONFIG.MAX_MESSAGES_PER_HOUR) {
    return { allowed: false, count: messagesLastHour }
  }

  return { allowed: true, count: messagesLastHour }
}

/**
 * SEC-01 / FT-02: Validate Twilio webhook signature using HMAC-SHA1.
 * Twilio docs: https://www.twilio.com/docs/usage/webhooks/webhook-security
 *
 * If TWILIO_AUTH_TOKEN is not set (dev/test), returns true with a warning.
 */
export async function validateTwilioSignature(
  authToken: string,
  signature: string,
  url: string,
  params: URLSearchParams,
): Promise<boolean> {
  if (!signature) return false

  // Build the signed string: url + alphabetically sorted key+value pairs
  const sortedKeys = [...params.keys()].sort()
  let str = url
  for (const key of sortedKeys) {
    str += key + (params.get(key) ?? '')
  }

  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(authToken),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  )

  const sigBytes = await crypto.subtle.sign('HMAC', key, encoder.encode(str))
  const computed = btoa(String.fromCharCode(...new Uint8Array(sigBytes)))

  // Constant-time comparison to prevent timing attacks
  if (computed.length !== signature.length) return false
  let mismatch = 0
  for (let i = 0; i < computed.length; i++) {
    mismatch |= computed.charCodeAt(i) ^ signature.charCodeAt(i)
  }
  return mismatch === 0
}

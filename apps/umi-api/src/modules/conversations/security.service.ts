import { Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { PgService } from '../../shared/database/pg.service';

/**
 * Inbound security: rate limiting, prompt-injection detection, input/output
 * sanitization, order/cart validation, and Twilio signature validation. Ported
 * from `whatsapp-handler/security.ts`.
 *
 * The pure functions are exported standalone (no DI) so the turn loop and intent
 * extractor can call them without injecting the service. `checkRateLimit` is the
 * only DB-bound piece — rebound to canonical `comms.*` and run on the worker
 * pool (unauthenticated WhatsApp path), with explicit tenant predicates.
 */

export const SECURITY_CONFIG = {
  MAX_MESSAGE_LENGTH: 500,
  MAX_MESSAGES_PER_MINUTE: 10,
  MAX_MESSAGES_PER_HOUR: 50,
  // SEC-02: structural injection patterns only — no broad keyword matching that
  // would false-positive on legitimate Spanish café vocabulary.
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
    /^\s*(system|assistant)\s*:/im,
    /\bDAN\b.*mode/i,
    /jailbreak/i,
  ],
} as const;

export function detectPromptInjection(message: string): {
  detected: boolean;
  pattern?: string;
} {
  for (const pattern of SECURITY_CONFIG.SUSPICIOUS_PATTERNS) {
    if (pattern.test(message)) {
      return { detected: true, pattern: pattern.toString() };
    }
  }
  return { detected: false };
}

export function sanitizeInput(input: string | undefined | null): string {
  const sanitized = (input ?? '')
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+\s*=/gi, '')
    .replace(/\{\{.*?\}\}/g, '')
    .replace(/<\|.*?\|>/g, '')
    .replace(/\[INST\]/gi, '')
    .replace(/\[\/INST\]/gi, '');

  return sanitized.trim().substring(0, SECURITY_CONFIG.MAX_MESSAGE_LENGTH);
}

export function sanitizeOutput(output: string): string {
  return output
    .replace(/ANTHROPIC_API_KEY/gi, '[REDACTED]')
    .replace(/SUPABASE.*KEY/gi, '[REDACTED]')
    .replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, '[REDACTED]')
    // Strip transcript-continuation hallucinations: lines starting with a role.
    .replace(/\n(user|assistant|cliente|asistente):\s*.*/gi, '')
    .trim();
}

export interface OrderItemInput {
  product_name?: unknown;
  quantity?: unknown;
}

export function validateOrderItems(items: OrderItemInput[]): {
  valid: boolean;
  reason?: string;
} {
  if (!Array.isArray(items) || items.length === 0) {
    return { valid: false, reason: 'No hay items en la orden' };
  }
  if (items.length > 20) {
    return { valid: false, reason: 'Demasiados items (máximo 20)' };
  }

  for (const item of items) {
    if (
      !item.product_name ||
      typeof item.product_name !== 'string' ||
      item.product_name.trim().length === 0
    ) {
      return { valid: false, reason: 'Nombre de producto inválido' };
    }
    if (
      typeof item.quantity !== 'number' ||
      !Number.isInteger(item.quantity) ||
      item.quantity < 1 ||
      item.quantity > 50
    ) {
      return { valid: false, reason: 'Cantidad inválida (1-50)' };
    }
  }

  return { valid: true };
}

export function validateCartItems(cart: unknown): {
  valid: boolean;
  reason?: string;
} {
  if (cart == null) return { valid: true };
  if (typeof cart !== 'object' || Array.isArray(cart)) {
    return { valid: false, reason: 'draft_cart debe ser un objeto' };
  }

  const c = cart as Record<string, unknown>;
  const items = c.items;
  const updatedAt = c.updated_at;
  const customerNote = c.customer_note;

  if (!Array.isArray(items)) {
    return { valid: false, reason: 'draft_cart.items debe ser un arreglo' };
  }
  if (typeof updatedAt !== 'string' || Number.isNaN(Date.parse(updatedAt))) {
    return { valid: false, reason: 'draft_cart.updated_at inválido' };
  }
  if (customerNote != null && typeof customerNote !== 'string') {
    return { valid: false, reason: 'draft_cart.customer_note inválido' };
  }
  if (items.length > 50) {
    return { valid: false, reason: 'draft_cart tiene demasiados items' };
  }

  for (const raw of items) {
    if (!raw || typeof raw !== 'object') {
      return { valid: false, reason: 'Item de carrito inválido' };
    }
    const item = raw as Record<string, unknown>;
    if (typeof item.product_id !== 'string' || item.product_id.trim().length === 0) {
      return { valid: false, reason: 'product_id inválido' };
    }
    if (
      typeof item.product_name !== 'string' ||
      item.product_name.trim().length === 0
    ) {
      return { valid: false, reason: 'product_name inválido' };
    }
    if (item.variant_name != null && typeof item.variant_name !== 'string') {
      return { valid: false, reason: 'variant_name inválido' };
    }
    if (
      typeof item.quantity !== 'number' ||
      !Number.isInteger(item.quantity) ||
      item.quantity < 1 ||
      item.quantity > 50
    ) {
      return { valid: false, reason: 'quantity inválido' };
    }
    if (
      typeof item.unit_price !== 'number' ||
      !Number.isFinite(item.unit_price) ||
      item.unit_price < 0
    ) {
      return { valid: false, reason: 'unit_price inválido' };
    }
  }

  return { valid: true };
}

/**
 * SEC-01 / FT-02: validate the Twilio webhook signature (HMAC-SHA1 over the
 * full URL + alphabetically-sorted key+value pairs, base64). Node port of the
 * Deno `crypto.subtle` original. The URL must be the EXACT public URL Twilio
 * signed (`TWILIO_WEBHOOK_URL`), never inferred from `req.url`.
 */
export function validateTwilioSignature(
  authToken: string,
  signature: string,
  url: string,
  params: URLSearchParams,
): boolean {
  if (!signature) return false;

  const sortedKeys = [...params.keys()].sort();
  let str = url;
  for (const key of sortedKeys) {
    str += key + (params.get(key) ?? '');
  }

  const computed = createHmac('sha1', authToken).update(str, 'utf8').digest('base64');
  const a = Buffer.from(computed);
  const b = Buffer.from(signature);
  // Constant-time compare; length check first (timingSafeEqual throws on mismatch).
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

@Injectable()
export class SecurityService {
  constructor(private readonly pg: PgService) {}

  /**
   * Rate-limit a sender by counting their user messages in the last minute/hour
   * on their most recent active conversation. Reads `tenant.conversation` +
   * `tenant.message` (build-v2).
   */
  async checkRateLimit(
    tenantId: string,
    personId: string,
  ): Promise<{ allowed: boolean; count: number }> {
    const conv = await this.pg.query<{ id: string }>(
      `SELECT id
         FROM tenant.conversation
        WHERE customer_id = $1
          AND business_id = $2
          AND status IN ('open', 'active', 'pending')
          AND last_message_at >= now() - interval '1 hour'
        ORDER BY last_message_at DESC
        LIMIT 1`,
      [personId, tenantId],
    );
    if (!conv.rows[0]) return { allowed: true, count: 0 };

    const counts = await this.pg.query<{ minute: string; hour: string }>(
      `SELECT
         count(*) FILTER (WHERE created_at >= now() - interval '1 minute') AS minute,
         count(*) FILTER (WHERE created_at >= now() - interval '1 hour')   AS hour
       FROM tenant.message
       WHERE conversation_id = $1 AND sender = 'customer'`,
      [conv.rows[0].id],
    );

    const perMinute = Number(counts.rows[0]?.minute ?? 0);
    const perHour = Number(counts.rows[0]?.hour ?? 0);

    if (perMinute >= SECURITY_CONFIG.MAX_MESSAGES_PER_MINUTE) {
      return { allowed: false, count: perMinute };
    }
    if (perHour >= SECURITY_CONFIG.MAX_MESSAGES_PER_HOUR) {
      return { allowed: false, count: perHour };
    }
    return { allowed: true, count: perHour };
  }
}

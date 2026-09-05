import { createHmac } from 'node:crypto';

export function posPinLookupHash(secret: string, tenantId: string, pin: string): string {
  return createHmac('sha256', secret).update(`umi-pos-pin:${tenantId}:${pin}`).digest('hex');
}

/**
 * Keyed lookup for a manager card token. It mirrors `posPinLookupHash` but uses
 * a distinct domain string, so a card token can never be presented as a PIN (or
 * the reverse) even if the two ever shared a value.
 */
export function posCardLookupHash(secret: string, tenantId: string, cardToken: string): string {
  return createHmac('sha256', secret).update(`umi-pos-card:${tenantId}:${cardToken}`).digest('hex');
}

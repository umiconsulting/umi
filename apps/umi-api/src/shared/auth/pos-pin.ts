import { createHmac } from 'node:crypto';

export function posPinLookupHash(secret: string, tenantId: string, pin: string): string {
  return createHmac('sha256', secret).update(`umi-pos-pin:${tenantId}:${pin}`).digest('hex');
}

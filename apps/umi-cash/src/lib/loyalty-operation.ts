export type ScanRequest = { qrPayload: string; actions: string[]; redeemQuantity?: number; externalReceiptNumber?: string; idempotencyKey?: string };

/** Keep an uncertain command unchanged until the server returns a definite result. */
export class LoyaltyOperation {
  private request: ScanRequest | null = null;
  constructor(private key: () => string = () => crypto.randomUUID()) {}
  get pending() { return this.request !== null; }
  begin(request: ScanRequest): ScanRequest {
    if (!this.request) this.request = Object.freeze({ ...request, actions: Object.freeze([...request.actions]) as unknown as string[], idempotencyKey: this.key() });
    return this.request;
  }
  finish(status: number) {
    if ((status >= 200 && status < 300) || (status >= 400 && status < 500 && ![408, 425, 429].includes(status))) this.request = null;
  }
}

export function toggleLoyaltyAction(actions: Set<string>, key: string, singleCycle: boolean): Set<string> {
  const next = new Set(actions);
  if (next.has(key)) { next.delete(key); return next; }
  if (key === 'REDEEM') next.delete('REDEEM_BASE');
  if (key === 'REDEEM_BASE') next.delete('REDEEM');
  if (singleCycle && ['VISIT', 'REDEEM', 'REDEEM_BASE'].includes(key)) {
    for (const action of ['VISIT', 'REDEEM', 'REDEEM_BASE']) next.delete(action);
  }
  next.add(key);
  return next;
}

export function rewardExpiryLabel(expiresAt: string | null | undefined, timezone = 'America/Mexico_City') {
  return expiresAt ? new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short', timeZone: timezone }).format(new Date(expiresAt)) : null;
}

export function loyaltyResponseMessage(payload: unknown): string {
  if (typeof payload === 'string') return payload;
  if (Array.isArray(payload)) return payload.filter((item) => typeof item === 'string').join('. ') || 'No se pudo completar la operación.';
  if (payload && typeof payload === 'object') {
    const value = payload as { message?: unknown; error?: unknown };
    if (value.message !== undefined) return loyaltyResponseMessage(value.message);
    if (value.error !== undefined) return loyaltyResponseMessage(value.error);
  }
  return 'No se pudo completar la operación.';
}

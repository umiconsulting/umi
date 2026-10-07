/** Keep the original command after an uncertain response. */
export class LoyaltyOperation {
  request = null;
  constructor(key = () => crypto.randomUUID()) {
    this.key = key;
  }
  get pending() {
    return this.request !== null;
  }
  begin(request) {
    if (!this.request) this.request = Object.freeze({ ...request, idempotencyKey: this.key() });
    return this.request;
  }
  finish(status) {
    if (
      (status >= 200 && status < 300) ||
      (status >= 400 && status < 500 && ![408, 425, 429].includes(status))
    )
      this.request = null;
  }
}
export function rewardExpiryLabel(expiresAt, timezone = 'America/Mexico_City') {
  return expiresAt
    ? new Intl.DateTimeFormat('es-MX', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: timezone,
      }).format(new Date(expiresAt))
    : null;
}

export function rewardVisitCostLabel(visits, cost) {
  return `${cost} visitas · quedan ${Math.max(0, visits - cost)}`;
}

import { i18n } from '@lingui/core';
import { plural } from '@lingui/core/macro';
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
    ? new Intl.DateTimeFormat(i18n.locale === 'en' ? 'en-US' : 'es-MX', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: timezone,
      }).format(new Date(expiresAt))
    : null;
}

export function rewardVisitCostLabel(visits, cost) {
  const remaining = Math.max(0, visits - cost);
  return `${plural(cost, { one: '# visita', other: '# visitas' })} · ${plural(remaining, { one: '# visita restante', other: '# visitas restantes' })}`;
}

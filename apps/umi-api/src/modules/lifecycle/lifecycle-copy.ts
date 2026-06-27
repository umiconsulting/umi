/**
 * CRON lifecycle copy — ported BYTE-FOR-BYTE from the ConversaFlow `cash-cron.ts`
 * (`DEFAULT_LIFECYCLE_COPY`). These are the scheduled WhatsApp journeys
 * (welcome / winback / reward-expiring / streak), distinct from the scan-moment
 * journeys in `modules/cash/lifecycle-copy.ts`. The `{var}` interpolation helper
 * is shared (pure) — imported rather than duplicated.
 */
import { renderTemplate } from '../cash/lifecycle-copy';

export { renderTemplate };

export type CronJourneyKey =
  | 'welcome_no_visit'
  | 'winback_14'
  | 'winback_30'
  | 'winback_60'
  | 'reward_expiring'
  | 'streak_3w'
  | 'streak_6w'
  | 'streak_12w';

export const CRON_LIFECYCLE_COPY: Record<CronJourneyKey, string> = {
  welcome_no_visit:
    '¡Hola {name}! Tu tarjeta de {tenant} te espera ☕ — visítanos para tu primer sello.',
  winback_14:
    'Te extrañamos en {tenant}. Tienes {visitsThisCycle}/{visitsRequired} sellos esperándote.',
  winback_30:
    'Han pasado 30 días, {name}. Vuelve y sigue acumulando sellos para tu {rewardName}.',
  winback_60:
    '{name}, queremos volver a verte en {tenant}. Tu tarjeta sigue activa.',
  reward_expiring:
    '⏰ Tu {rewardName} expira el {date} — pasa por {tenant} antes de que se acabe.',
  streak_3w: '🔥 ¡3 semanas seguidas visitando {tenant}! Sigue así, {name}.',
  streak_6w: '🔥 ¡6 semanas seguidas! {name}, eres parte de la familia de {tenant}.',
  streak_12w: '🏆 ¡12 semanas seguidas! Gracias por tu fidelidad, {name}.',
};

const DEFAULT_TZ = 'America/Mexico_City';

/** Tenant override (`programs.branding.lifecycle_copy[journey]`) else the default. */
export function resolveCronJourneyTemplate(
  lifecycleCopy: unknown,
  journey: CronJourneyKey,
): string {
  if (lifecycleCopy && typeof lifecycleCopy === 'object') {
    const v = (lifecycleCopy as Record<string, unknown>)[journey];
    if (typeof v === 'string' && v.trim().length > 0) return v;
  }
  return CRON_LIFECYCLE_COPY[journey] ?? `{name}, mensaje de {tenant}`;
}

/** Format a date in a timezone as "d de MMMM" (Spanish), matching the source. */
export function formatDateLabel(date: Date | string, tz: string): string {
  try {
    const d = date instanceof Date ? date : new Date(date);
    return d.toLocaleDateString('es-MX', {
      day: 'numeric',
      month: 'long',
      timeZone: tz || DEFAULT_TZ,
    });
  } catch {
    return String(date);
  }
}

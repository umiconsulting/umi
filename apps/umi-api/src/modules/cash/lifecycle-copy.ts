/**
 * Scan "moment" lifecycle copy — ported BYTE-FOR-BYTE from umi-cash
 * `lifecycle-copy.ts`. These strings drive the lock-screen pass message the
 * customer sees right after a scan; paraphrasing changes customer-facing voice.
 */
export type LifecycleJourneyKey =
  'first_visit' | 'milestone_halfway' | 'milestone_one_left' | 'reward_earned';

export const DEFAULT_LIFECYCLE_COPY: Record<LifecycleJourneyKey, string> = {
  first_visit: '¡Bienvenido a {tenant}, {name}! 🎉 Acumulaste tu primer sello.',
  milestone_halfway:
    '¡Vas a la mitad! {visitsThisCycle}/{visitsRequired} sellos hacia tu {rewardName} en {tenant}.',
  milestone_one_left: '¡{name}, solo te falta 1 visita para tu {rewardName}! 🚀',
  reward_earned: '🎉 ¡Ganaste {rewardName}! Pasa a canjearla en {tenant}.',
};

/** `{var}` interpolation; unknown vars are left literally in place (bug signal). */
export function renderTemplate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    const v = vars[key];
    return v !== undefined ? String(v) : match;
  });
}

/** Tenant override (programs.branding.lifecycle_copy[journey]) else the default. */
export function resolveJourneyTemplate(
  lifecycleCopy: unknown,
  journey: LifecycleJourneyKey,
): string {
  if (lifecycleCopy && typeof lifecycleCopy === 'object') {
    const v = (lifecycleCopy as Record<string, unknown>)[journey];
    if (typeof v === 'string' && v.trim().length > 0) return v;
  }
  return DEFAULT_LIFECYCLE_COPY[journey];
}

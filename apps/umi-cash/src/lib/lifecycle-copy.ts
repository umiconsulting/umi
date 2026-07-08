/**
 * Default copy + template rendering for automated lifecycle messages.
 * Tenants can override any journey's text via `tenant.lifecycleCopy`.
 *
 * Two categories of journeys share this registry:
 *   - cron-driven (welcome, winback, expiring, streaks) — go through sendLifecycleMessage,
 *     logged to LifecycleEvent, visible in /admin/messages.
 *   - scan-driven moments (first_visit, milestones, reward_earned) — written directly to
 *     card.lifecycleMessage from the scan handler, no LifecycleEvent.
 */

export type LifecycleJourneyKey =
  | 'welcome_no_visit'
  | 'winback_14'
  | 'winback_30'
  | 'winback_60'
  | 'reward_expiring'
  | 'first_visit'
  | 'milestone_halfway'
  | 'milestone_one_left'
  | 'reward_earned'
  | 'streak_3w'
  | 'streak_6w'
  | 'streak_12w';

export const LIFECYCLE_JOURNEYS: { key: LifecycleJourneyKey; label: string; description: string }[] = [
  // Scan-time moments
  {
    key: 'first_visit',
    label: 'Primer sello',
    description: 'Cliente acaba de registrar su primera visita.',
  },
  {
    key: 'milestone_halfway',
    label: 'Mitad del camino',
    description: 'Cliente llegó a la mitad de los sellos requeridos.',
  },
  {
    key: 'milestone_one_left',
    label: 'A una visita',
    description: 'Cliente está a una visita de su recompensa.',
  },
  {
    key: 'reward_earned',
    label: 'Recompensa ganada',
    description: 'Cliente completó el ciclo y ganó una recompensa.',
  },
  // Cron-driven journeys
  {
    key: 'welcome_no_visit',
    label: 'Bienvenida sin visita',
    description: 'Cliente se registró pero no ha visitado en 7 días.',
  },
  {
    key: 'winback_14',
    label: 'Recuperación 14 días',
    description: 'Cliente sin visitas en 14 días.',
  },
  {
    key: 'winback_30',
    label: 'Recuperación 30 días',
    description: 'Cliente sin visitas en 30 días.',
  },
  {
    key: 'winback_60',
    label: 'Recuperación 60 días',
    description: 'Cliente sin visitas en 60 días.',
  },
  {
    key: 'reward_expiring',
    label: 'Recompensa por expirar',
    description: 'Recompensa de cumpleaños expira en menos de 3 días.',
  },
  {
    key: 'streak_3w',
    label: 'Racha 3 semanas',
    description: 'Cliente ha visitado cada una de las últimas 3 semanas.',
  },
  {
    key: 'streak_6w',
    label: 'Racha 6 semanas',
    description: 'Cliente ha visitado cada una de las últimas 6 semanas.',
  },
  {
    key: 'streak_12w',
    label: 'Racha 12 semanas',
    description: 'Cliente ha visitado cada una de las últimas 12 semanas.',
  },
];

// Variables available to each journey. Surface in the admin UI as hints.
export const LIFECYCLE_VARIABLES: Record<LifecycleJourneyKey, string[]> = {
  welcome_no_visit:   ['{name}', '{tenant}'],
  winback_14:         ['{name}', '{tenant}', '{rewardName}', '{visitsThisCycle}', '{visitsRequired}'],
  winback_30:         ['{name}', '{tenant}', '{rewardName}', '{visitsThisCycle}', '{visitsRequired}'],
  winback_60:         ['{name}', '{tenant}', '{rewardName}', '{visitsThisCycle}', '{visitsRequired}'],
  reward_expiring:    ['{name}', '{tenant}', '{rewardName}', '{date}'],
  first_visit:        ['{name}', '{tenant}', '{rewardName}'],
  milestone_halfway:  ['{name}', '{tenant}', '{rewardName}', '{visitsThisCycle}', '{visitsRequired}'],
  milestone_one_left: ['{name}', '{tenant}', '{rewardName}'],
  reward_earned:      ['{name}', '{tenant}', '{rewardName}'],
  streak_3w:          ['{name}', '{tenant}', '{rewardName}'],
  streak_6w:          ['{name}', '{tenant}', '{rewardName}'],
  streak_12w:         ['{name}', '{tenant}', '{rewardName}'],
};

export const DEFAULT_LIFECYCLE_COPY: Record<LifecycleJourneyKey, string> = {
  welcome_no_visit:   '¡Hola {name}! Tu tarjeta de {tenant} te espera ☕ — visítanos para tu primer sello.',
  winback_14:         'Te extrañamos en {tenant}. Tienes {visitsThisCycle}/{visitsRequired} sellos esperándote.',
  winback_30:         'Han pasado 30 días, {name}. Vuelve y sigue acumulando sellos para tu {rewardName}.',
  winback_60:         '{name}, queremos volver a verte en {tenant}. Tu tarjeta sigue activa.',
  reward_expiring:    '⏰ Tu {rewardName} expira el {date} — pasa por {tenant} antes de que se acabe.',
  first_visit:        '¡Bienvenido a {tenant}, {name}! 🎉 Acumulaste tu primer sello.',
  milestone_halfway:  '¡Vas a la mitad! {visitsThisCycle}/{visitsRequired} sellos hacia tu {rewardName} en {tenant}.',
  milestone_one_left: '¡{name}, solo una visita más y tu {rewardName} es tuyo! 🎁 Te esperamos en {tenant}.',
  reward_earned:      '🎉 ¡Felicidades {name}! Ganaste {rewardName} — te espera en {tenant}, canjéalo en tu próxima visita.',
  streak_3w:          '🔥 ¡3 semanas seguidas visitando {tenant}! Sigue así, {name}.',
  streak_6w:          '🔥 ¡6 semanas seguidas! {name}, eres parte de la familia de {tenant}.',
  streak_12w:         '🏆 ¡12 semanas seguidas! Gracias por tu fidelidad, {name}.',
};

/** Substitutes {var} placeholders. Unknown vars are left in place (visible bug signal). */
export function renderTemplate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    const v = vars[key];
    return v !== undefined ? String(v) : match;
  });
}

/**
 * Picks the tenant override for a journey if set + non-empty, else the default.
 * Accepts the raw JSON value off `tenant.lifecycleCopy` (unknown shape).
 */
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

import { describe, expect, it } from 'vitest';
import { DEFAULT_LIFECYCLE_COPY, renderTemplate, resolveJourneyTemplate } from './lifecycle-copy';

describe('renderTemplate', () => {
  it('interpolates known vars and leaves unknown ones literally', () => {
    const out = renderTemplate('¡Hola {name}, {missing}!', { name: 'Ana' });
    expect(out).toBe('¡Hola Ana, {missing}!');
  });

  it('renders the reward_earned default copy', () => {
    const out = renderTemplate(DEFAULT_LIFECYCLE_COPY.reward_earned, {
      rewardName: 'Café',
      tenant: 'Kala',
    });
    expect(out).toBe('🎉 ¡Ganaste Café! Pasa a canjearla en Kala.');
  });
});

describe('resolveJourneyTemplate', () => {
  it('prefers a non-empty tenant override', () => {
    expect(resolveJourneyTemplate({ first_visit: 'custom {name}' }, 'first_visit')).toBe(
      'custom {name}',
    );
  });

  it('falls back to the default when override is missing/blank/non-object', () => {
    expect(resolveJourneyTemplate({ first_visit: '   ' }, 'first_visit')).toBe(
      DEFAULT_LIFECYCLE_COPY.first_visit,
    );
    expect(resolveJourneyTemplate(null, 'reward_earned')).toBe(
      DEFAULT_LIFECYCLE_COPY.reward_earned,
    );
    expect(resolveJourneyTemplate('nope', 'milestone_one_left')).toBe(
      DEFAULT_LIFECYCLE_COPY.milestone_one_left,
    );
  });
});

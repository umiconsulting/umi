import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LIFECYCLE_COPY,
  LIFECYCLE_JOURNEYS,
  LIFECYCLE_VARIABLES,
  renderTemplate,
  resolveJourneyTemplate,
} from './lifecycle-copy';

describe('renderTemplate', () => {
  it('interpolates known vars and leaves unknown ones literally', () => {
    const out = renderTemplate('¡Hola {name}, {missing}!', { name: 'Ana' });
    expect(out).toBe('¡Hola Ana, {missing}!');
  });

  it('renders the reward_earned default copy with the umi-cash wording', () => {
    const out = renderTemplate(DEFAULT_LIFECYCLE_COPY.reward_earned, {
      name: 'Ana',
      rewardName: 'Café',
      tenant: 'Kala',
    });
    expect(out).toBe('🎉 ¡Felicidades Ana! Ganaste Café — te espera en Kala, canjéalo en tu próxima visita.');
  });
});

describe('resolveJourneyTemplate', () => {
  it('prefers a non-empty merchant override', () => {
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

/**
 * The registry is the Settings screen's contract. A journey added to the copy but
 * not to the tables renders a blank row; a key in the tables with no copy throws at
 * render time on a customer's lock screen.
 */
describe('the journey registry', () => {
  it('covers every journey in both tables, with no extras on either side', () => {
    const keys = Object.keys(DEFAULT_LIFECYCLE_COPY).sort();
    expect(LIFECYCLE_JOURNEYS.map((j) => j.key).sort()).toEqual(keys);
    expect(Object.keys(LIFECYCLE_VARIABLES).sort()).toEqual(keys);
  });

  it('carries all fifteen journeys, so the register panel sees the same list', () => {
    expect(LIFECYCLE_JOURNEYS).toHaveLength(15);
  });

  it('gives every journey a non-empty label, description and variable list', () => {
    for (const { key, label, description } of LIFECYCLE_JOURNEYS) {
      expect(label.length).toBeGreaterThan(0);
      expect(description.length).toBeGreaterThan(0);
      expect(LIFECYCLE_VARIABLES[key].length).toBeGreaterThan(0);
    }
  });
});

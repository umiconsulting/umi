import { describe, it, expect } from 'vitest';
import {
  DEFAULT_LIFECYCLE_COPY,
  LIFECYCLE_JOURNEYS,
  LIFECYCLE_VARIABLES,
  renderTemplate,
  resolveJourneyTemplate,
} from './lifecycle-copy';

describe('visit_recorded journey', () => {
  it('is registered across the whole journey registry', () => {
    // Every plain visit renders this moment (the single Apple changeMessage
    // channel) — missing registry entries would silence per-visit notifications.
    expect(LIFECYCLE_JOURNEYS.map((j) => j.key)).toContain('visit_recorded');
    expect(DEFAULT_LIFECYCLE_COPY.visit_recorded).toBeTruthy();
    expect(LIFECYCLE_VARIABLES.visit_recorded).toEqual(['{name}', '{tenant}', '{rewardName}', '{visitsThisCycle}', '{visitsRequired}']);
  });

  it('renders progress with every variable substituted', () => {
    const body = renderTemplate(resolveJourneyTemplate(null, 'visit_recorded'), {
      name: 'Lucia',
      tenant: 'Kalala Café',
      rewardName: 'Bebida gratis',
      visitsThisCycle: 4,
      visitsRequired: 10,
    });
    expect(body).toContain('4/10');
    expect(body).toContain('Bebida gratis');
    expect(body).not.toMatch(/\{\w+\}/); // no unsubstituted placeholders
    expect(body.length).toBeLessThanOrEqual(200); // wallet display budget (broadcast rule)
  });
});

describe('reward_redeemed journey', () => {
  it('is registered across the whole journey registry', () => {
    // A journey missing from any of these maps silently renders nothing (or
    // crashes the admin copy editor), so the registry must stay complete.
    expect(LIFECYCLE_JOURNEYS.map((j) => j.key)).toContain('reward_redeemed');
    expect(DEFAULT_LIFECYCLE_COPY.reward_redeemed).toBeTruthy();
    expect(LIFECYCLE_VARIABLES.reward_redeemed).toEqual(['{name}', '{tenant}', '{rewardName}']);
  });

  it('renders the default copy with every variable substituted', () => {
    const body = renderTemplate(resolveJourneyTemplate(null, 'reward_redeemed'), {
      name: 'Lucia',
      tenant: 'Kalala Café',
      rewardName: 'Bebida gratis',
    });
    expect(body).toContain('Lucia');
    expect(body).toContain('Kalala Café');
    expect(body).toContain('Bebida gratis');
    expect(body).not.toMatch(/\{\w+\}/); // no unsubstituted placeholders
    expect(body.length).toBeLessThanOrEqual(200); // wallet display budget (broadcast rule)
  });

  it('honors a tenant override like every other journey', () => {
    const template = resolveJourneyTemplate(
      { reward_redeemed: '¡Gracias {name}!' },
      'reward_redeemed',
    );
    expect(renderTemplate(template, { name: 'Ana' })).toBe('¡Gracias Ana!');
  });
});

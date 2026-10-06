import { describe, it, expect } from 'vitest';
import { VISIT_CAP_HINT, visitCapNotice } from './visit-cap';

describe('daily visit cap copy', () => {
  it('names the time of the visit already registered today', () => {
    // 16:15Z = 9:15 in Culiacán (America/Mazatlan, UTC-7).
    const notice = visitCapNotice('2026-09-01T16:15:00.000Z', 'America/Mazatlan');
    expect(notice).toContain('Visita ya registrada hoy');
    expect(notice).toContain('9:15');
    expect(notice).toContain('mañana');
  });

  it('stays a complete sentence when the visit time is unknown', () => {
    const notice = visitCapNotice(null);
    expect(notice).toContain('Visita ya registrada hoy');
    expect(notice).not.toContain('a las');
    expect(notice).toContain('mañana');
  });

  it('never promises a rolling countdown — the cap lifts at midnight, not +24h', () => {
    // The old checkbox hint computed lastVisitAt + 24h ("Disponible en 23h 40m"),
    // overstating the wait; both strings must say "mañana" instead.
    expect(VISIT_CAP_HINT).toContain('mañana');
    expect(VISIT_CAP_HINT).not.toMatch(/\d+h/);
    expect(visitCapNotice('2026-09-01T16:15:00.000Z', 'America/Mazatlan')).not.toMatch(/\d+h/);
  });
});

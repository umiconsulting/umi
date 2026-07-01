import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DiagnosticService } from './diagnostic.service';

function make() {
  const repo = {
    upsertByEmail: vi.fn().mockResolvedValue({
      lead: { id: 'lead-1', email: 'a@b.co', name: 'Ana', emailsSent: [] },
      isNew: true,
    }),
    recordEvent: vi.fn().mockResolvedValue(undefined),
  };
  const sequences = {
    sendWelcome: vi.fn().mockResolvedValue(true),
  };
  return {
    svc: new DiagnosticService(repo as never, sequences as never),
    repo,
    sequences,
  };
}

describe('DiagnosticService.score', () => {
  const svc = make().svc;

  it('returns Inicial with area fallback 1 when there are no responses', () => {
    const r = svc.score({});
    expect(r.level).toBe('Inicial');
    expect(r.score).toBe(1);
    expect(r.areas).toEqual({
      dataCollection: 1,
      analysis: 1,
      visualization: 1,
      decisionMaking: 1,
    });
    expect(r.recommendations.length).toBeGreaterThan(0);
  });

  it('maps known string answers via the score map (siempre → 5) → Intermedio', () => {
    // Every area key answered 'siempre' (=5) → each area 5 → total 5.
    const responses: Record<string, string> = {};
    for (const k of [
      'analytics_stage', 'data_challenge', 'data_sources', 'data_quality', 'data_integration',
      'decision_basis', 'analysis_tools', 'analysis_frequency', 'analysis_depth',
      'visualization_tools', 'dashboard_usage', 'report_creation',
      'decision_speed', 'data_driven_decisions', 'kpi_tracking',
    ]) responses[k] = 'siempre';
    const r = svc.score(responses);
    expect(r.score).toBe(5);
    expect(r.level).toBe('Intermedio');
  });

  it('reaches Avanzado when numeric answers push the average ≥ 8', () => {
    const responses: Record<string, number> = {};
    for (const k of [
      'analytics_stage', 'data_challenge', 'data_sources', 'data_quality', 'data_integration',
      'decision_basis', 'analysis_tools', 'analysis_frequency', 'analysis_depth',
      'visualization_tools', 'dashboard_usage', 'report_creation',
      'decision_speed', 'data_driven_decisions', 'kpi_tracking',
    ]) responses[k] = 9;
    const r = svc.score(responses);
    expect(r.score).toBe(9);
    expect(r.level).toBe('Avanzado');
  });

  it('unknown string answers default to 1', () => {
    const r = svc.score({ analytics_stage: 'zzz', data_challenge: 'qqq' });
    // Only dataCollection/analysis touched via analytics_stage/data_challenge → 1
    expect(r.areas.dataCollection).toBe(1);
  });
});

describe('DiagnosticService.process', () => {
  let h: ReturnType<typeof make>;
  beforeEach(() => (h = make()));

  it('upserts, records diagnostic_completed, and sends welcome for a new lead', async () => {
    const r = await h.svc.process({ email: 'a@b.co', name: 'Ana', responses: {} });
    expect(h.repo.upsertByEmail).toHaveBeenCalledOnce();
    expect(h.repo.recordEvent).toHaveBeenCalledWith(
      'lead-1',
      'diagnostic_completed',
      expect.objectContaining({ is_new_lead: true, level: 'Inicial' }),
    );
    expect(h.sequences.sendWelcome).toHaveBeenCalledOnce();
    expect(r).toMatchObject({ isNewLead: true, leadId: 'lead-1' });
  });

  it('does NOT send welcome for an existing lead', async () => {
    h.repo.upsertByEmail.mockResolvedValue({
      lead: { id: 'lead-1', email: 'a@b.co', name: 'Ana', emailsSent: [] },
      isNew: false,
    });
    await h.svc.process({ email: 'a@b.co', name: 'Ana', responses: {} });
    expect(h.sequences.sendWelcome).not.toHaveBeenCalled();
  });
});

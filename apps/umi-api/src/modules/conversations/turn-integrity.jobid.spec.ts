import { describe, expect, it } from 'vitest';
import { turnProcessJobId } from './turn-integrity.service';

// Mirrors the central colon-sanitizer in EnqueueService.enqueue (jobs/enqueue.service.ts).
const sanitize = (s: string) => s.replace(/:/g, '_');

describe('turnProcessJobId', () => {
  const turnId = '11111111-1111-1111-1111-111111111111';
  const T1 = '2026-06-28T10:00:00.000Z';
  const T2 = '2026-06-28T10:00:05.000Z';

  it('is stable within a single release (idempotent dedup)', () => {
    expect(turnProcessJobId(turnId, T1)).toBe(turnProcessJobId(turnId, T1));
  });

  it('is distinct across re-releases (fresh release ⇒ new id, no poison dedup)', () => {
    expect(turnProcessJobId(turnId, T1)).not.toBe(turnProcessJobId(turnId, T2));
  });

  it('survives the central colon-sanitizer as a BullMQ-safe id (no ":", not all-digit)', () => {
    const sanitized = sanitize(turnProcessJobId(turnId, T1));
    expect(sanitized).not.toContain(':');
    expect(/^\d+$/.test(sanitized)).toBe(false);
  });
});

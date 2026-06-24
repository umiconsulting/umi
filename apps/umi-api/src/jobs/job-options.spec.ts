import { describe, expect, it } from 'vitest';
import { QUEUES } from './queues';
import {
  defaultJobOptions,
  JobPriority,
  QUEUE_RELIABILITY,
  toBullPriority,
  workerOptions,
} from './job-options';

describe('job-options priority inversion', () => {
  it('maps interactive to a lower (more urgent) BullMQ number than background', () => {
    // The live queue.jobs used higher-number = more urgent; BullMQ is inverted.
    expect(toBullPriority(JobPriority.Interactive)).toBeLessThan(
      toBullPriority(JobPriority.Default),
    );
    expect(toBullPriority(JobPriority.Default)).toBeLessThan(
      toBullPriority(JobPriority.Background),
    );
  });

  it('never emits priority 0 (BullMQ treats 0/unset as least urgent)', () => {
    for (const p of Object.values(JobPriority)) {
      expect(toBullPriority(p)).toBeGreaterThanOrEqual(1);
    }
  });

  it('defaults to Default priority', () => {
    expect(toBullPriority()).toBe(toBullPriority(JobPriority.Default));
  });
});

describe('job-options reliability defaults', () => {
  it('keeps the legacy outbox max_attempts of 5 on outbound', () => {
    expect(defaultJobOptions(QUEUES.outbound).attempts).toBe(5);
  });

  it('does not retry infra/system jobs', () => {
    expect(defaultJobOptions(QUEUES.system).attempts).toBe(1);
  });

  it('uses exponential backoff', () => {
    expect(defaultJobOptions(QUEUES.turns).backoff).toMatchObject({
      type: 'exponential',
    });
  });

  it('sizes the turns lock well above the legacy 2-minute reclaim', () => {
    const TWO_MINUTES = 120_000;
    expect(workerOptions(QUEUES.turns).lockDuration).toBeGreaterThan(TWO_MINUTES);
    expect(QUEUE_RELIABILITY[QUEUES.turns].lockDurationMs).toBe(300_000);
  });

  it('fails a twice-stalled job rather than retrying forever', () => {
    expect(workerOptions(QUEUES.turns).maxStalledCount).toBe(1);
  });
});

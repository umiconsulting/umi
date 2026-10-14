import { describe, expect, it } from 'vitest';
import { receiptTimeInZone } from './receipt-time';

describe('hora local del recibo', () => {
  it.each([
    ['2026-10-13T18:22:14.903Z', 'America/Mazatlan', '2026-10-13T11:22:14.903-07:00'],
    ['2026-10-13T02:22:14.903Z', 'America/Mazatlan', '2026-10-12T19:22:14.903-07:00'],
    ['2026-07-01T12:00:00.000Z', 'America/New_York', '2026-07-01T08:00:00.000-04:00'],
    ['2026-01-01T12:00:00.000Z', 'America/New_York', '2026-01-01T07:00:00.000-05:00'],
    ['2026-01-01T00:00:00.000Z', 'UTC', '2026-01-01T00:00:00.000+00:00'],
  ])('conserva %s en %s', (at, zone, expected) => {
    const actual = receiptTimeInZone(at, zone);
    expect(actual).toBe(expected);
    expect(new Date(actual).getTime()).toBe(new Date(at).getTime());
  });
});

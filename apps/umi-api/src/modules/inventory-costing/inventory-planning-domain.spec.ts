import { netRequirements } from './inventory-planning-domain';
import { describe, expect, it } from 'vitest';
import {
  add,
  ceil,
  holdout,
  predictPeriod,
  purchaseHorizon,
  shiftDate,
} from './inventory-planning-domain';
describe('inventory planning', () => {
  it('uses the next strictly later purchase date and handles Sunday', () => {
    expect(purchaseHorizon('2026-11-09', [1])).toHaveLength(7);
    expect(purchaseHorizon('2026-11-14', [0])).toEqual(['2026-11-14']);
    expect(purchaseHorizon('2026-11-14', [])).toEqual([]);
  });
  it('distinguishes absent history and observed zero', () => {
    expect(predictPeriod(new Map(), null, ['2026-11-10'], '2026-11-10')).toBeNull();
    expect(predictPeriod(new Map(), '2026-09-01', ['2026-11-10'], '2026-11-10')?.n).toBe(0n);
    expect(predictPeriod(new Map(), '2026-11-01', ['2026-11-10'], '2026-11-10')).toBeNull();
  });
  it('excludes the current incomplete day and rounds only after accumulation', () => {
    const history = new Map([
      ['2026-11-10', 1000n],
      ['2026-11-03', 3n],
    ]);
    expect(ceil(predictPeriod(history, '2026-09-01', ['2026-11-10'], '2026-11-10')!)).toBe(1n);
    expect(ceil(add({ n: 1n, d: 3n }, { n: 1n, d: 3n }))).toBe(1n);
  });
  it('evaluates seven held-out days without using their sales to train', () => {
    const history = new Map<string, bigint>();
    for (let i = 1; i <= 70; i++) history.set(shiftDate('2026-11-10', -i), i <= 7 ? 20n : 10n);
    expect(holdout(history, '2026-08-01', '2026-11-10')).toEqual({
      evaluatedDays: 7,
      mae: 10,
      baselineMae: 10,
    });
  });
});

it('nets shared preparation stock once before expanding ingredients', () => {
  const result = netRequirements(
    new Map([
      ['prep', { n: 10n, d: 1n }],
      ['raw', { n: 1n, d: 2n }],
    ]),
    new Map([
      [
        'prep',
        { available: 6n, minimum: 1n, components: [{ itemId: 'raw', quantity: { n: 3n, d: 2n } }] },
      ],
      ['raw', { available: 2n, minimum: 1n }],
    ]),
  );
  expect(result?.get('prep')).toEqual({ consumption: 10n, suggested: 5n, prepare: true });
  expect(result?.get('raw')).toEqual({ consumption: 8n, suggested: 7n, prepare: false });
});
it('aggregates every parent before netting a shared preparation', () => {
  const result = netRequirements(
    new Map([
      ['a', { n: 2n, d: 1n }],
      ['b', { n: 3n, d: 1n }],
    ]),
    new Map([
      [
        'a',
        {
          available: 0n,
          minimum: 0n,
          components: [{ itemId: 'shared', quantity: { n: 1n, d: 1n } }],
        },
      ],
      [
        'b',
        {
          available: 0n,
          minimum: 0n,
          components: [{ itemId: 'shared', quantity: { n: 1n, d: 1n } }],
        },
      ],
      [
        'shared',
        { available: 3n, minimum: 0n, components: [{ itemId: 'raw', quantity: { n: 2n, d: 1n } }] },
      ],
      ['raw', { available: 0n, minimum: 0n }],
    ]),
  );
  expect(result?.get('raw')?.suggested).toBe(4n);
});
it('withholds cyclic or missing ingredient graphs', () => {
  expect(
    netRequirements(
      new Map(),
      new Map([
        [
          'a',
          { available: 0n, minimum: 0n, components: [{ itemId: 'a', quantity: { n: 1n, d: 1n } }] },
        ],
      ]),
    ),
  ).toBeNull();
  expect(
    netRequirements(
      new Map(),
      new Map([
        [
          'a',
          {
            available: 0n,
            minimum: 0n,
            components: [{ itemId: 'missing', quantity: { n: 1n, d: 1n } }],
          },
        ],
      ]),
    ),
  ).toBeNull();
});

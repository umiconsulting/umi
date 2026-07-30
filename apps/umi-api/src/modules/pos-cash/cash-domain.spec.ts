import { describe, expect, it } from 'vitest';
import {
  calculateExpectedCash,
  calculateVariance,
  cashEntryEffect,
  canTransitionShift,
} from './cash-domain';

describe('Gate 3C cash domain', () => {
  it('reproduces expected cash from immutable ledger facts', () => {
    const result = calculateExpectedCash(
      'MXN',
      [
        { sequence: 1, type: 'opening_float', amountMinorUnits: 2_000, received: 0, change: 0 },
        {
          sequence: 2,
          type: 'cash_sale',
          amountMinorUnits: 8_000,
          received: 10_000,
          change: 2_000,
        },
        { sequence: 3, type: 'paid_in', amountMinorUnits: 1_000, received: 0, change: 0 },
        { sequence: 4, type: 'paid_out', amountMinorUnits: 500, received: 0, change: 0 },
        { sequence: 5, type: 'safe_drop', amountMinorUnits: 3_000, received: 0, change: 0 },
        {
          sequence: 6,
          type: 'count_observation',
          amountMinorUnits: 7_400,
          received: 0,
          change: 0,
        },
      ],
      9,
      new Date('2026-07-29T18:00:00.000Z'),
    );
    expect(result.expectedDrawerCash.minorUnits).toBe(7_500);
    expect(result.netCashSales.minorUnits).toBe(8_000);
    expect(result.ledgerSequence).toBe(6);
  });

  it('calculates signed variance without changing the expected cash', () => {
    const result = calculateVariance(7_500, 7_400, 100, 'MXN', 6);
    expect(result.signedVariance.minorUnits).toBe(-100);
    expect(result.absoluteVariance.minorUnits).toBe(100);
    expect(result.withinTolerance).toBe(true);
    expect(result.outcome).toBe('within_tolerance');
  });

  it('posts only the net physical cash effect', () => {
    expect(cashEntryEffect(10_000, 2_000)).toBe(8_000);
    expect(() => cashEntryEffect(2_000, 2_001)).toThrow();
  });

  it('rejects unsafe shift transitions', () => {
    expect(canTransitionShift('open', 'counting')).toBe(true);
    expect(canTransitionShift('counting', 'open')).toBe(false);
    expect(canTransitionShift('closed', 'open')).toBe(false);
  });

  it('keeps manual-terminal-only sales outside the physical cash ledger', () => {
    const result = calculateExpectedCash('MXN', [], 1);
    expect(result.expectedDrawerCash.minorUnits).toBe(0);
    expect(result.netCashSales.minorUnits).toBe(0);
  });

  it('uses only the cash component of a mixed tender', () => {
    const result = calculateExpectedCash(
      'MXN',
      [
        { sequence: 1, type: 'opening_float', amountMinorUnits: 0, received: 0, change: 0 },
        { sequence: 2, type: 'cash_sale', amountMinorUnits: 3_000, received: 3_000, change: 0 },
      ],
      2,
    );
    expect(result.netCashSales.minorUnits).toBe(3_000);
    expect(result.expectedDrawerCash.minorUnits).toBe(3_000);
  });

  it('applies Paid In, Paid Out, and Safe Drop with explicit signs', () => {
    expect(cashEntryEffect(2_000, 0)).toBe(2_000);
    const result = calculateExpectedCash(
      'MXN',
      [
        { sequence: 1, type: 'paid_in', amountMinorUnits: 5_000, received: 0, change: 0 },
        { sequence: 2, type: 'paid_out', amountMinorUnits: 1_000, received: 0, change: 0 },
        { sequence: 3, type: 'safe_drop', amountMinorUnits: 2_000, received: 0, change: 0 },
      ],
      3,
    );
    expect(result.expectedDrawerCash.minorUnits).toBe(2_000);
  });

  it('keeps count and variance observations outside expected cash', () => {
    const facts = [
      {
        sequence: 1,
        type: 'opening_float' as const,
        amountMinorUnits: 1_000,
        received: 0,
        change: 0,
      },
      {
        sequence: 2,
        type: 'count_observation' as const,
        amountMinorUnits: 900,
        received: 0,
        change: 0,
      },
      {
        sequence: 3,
        type: 'variance_resolution' as const,
        amountMinorUnits: 100,
        received: 0,
        change: 0,
      },
    ];
    expect(calculateExpectedCash('MXN', facts, 3).expectedDrawerCash.minorUnits).toBe(1_000);
  });

  it('classifies positive, negative, and zero variance', () => {
    expect(calculateVariance(1_000, 1_100, 50, 'MXN', 4).outcome).toBe('approval_required');
    expect(calculateVariance(1_000, 900, 50, 'MXN', 4).signedVariance.minorUnits).toBe(-100);
    expect(calculateVariance(1_000, 1_000, 0, 'MXN', 4).outcome).toBe('balanced');
  });

  it('rejects unsafe cash values and out-of-order ledger facts', () => {
    expect(() => cashEntryEffect(-1, 0)).toThrow();
    expect(() =>
      calculateExpectedCash(
        'MXN',
        [
          { sequence: 2, type: 'paid_in', amountMinorUnits: 1, received: 0, change: 0 },
          { sequence: 1, type: 'paid_in', amountMinorUnits: 1, received: 0, change: 0 },
        ],
        1,
      ),
    ).toThrow();
  });

  it('keeps closed and reconciliation states terminal for sale posting', () => {
    expect(canTransitionShift('reconciliation_required', 'closing')).toBe(true);
    expect(canTransitionShift('closing', 'closed')).toBe(true);
    expect(canTransitionShift('closed', 'suspended')).toBe(false);
  });
});

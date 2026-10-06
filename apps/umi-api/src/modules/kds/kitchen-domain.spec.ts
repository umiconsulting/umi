import { describe, expect, it } from 'vitest';
import {
  deriveKitchenOrderStatus,
  resolveKitchenRoutes,
  validateKitchenTransition,
} from './kitchen-domain';

const lines = [
  { id: 'line-coffee', productId: 'coffee', categoryId: 'drink', requiresPreparation: true },
  { id: 'line-food', productId: 'sandwich', categoryId: 'food', requiresPreparation: true },
  { id: 'line-retail', productId: 'beans', categoryId: 'retail', requiresPreparation: false },
];

describe('canonical kitchen routing', () => {
  it('uses product, category, then location default precedence', () => {
    const result = resolveKitchenRoutes(lines, [
      { id: 'default', stationId: 'expo', productId: null, categoryId: null, priority: 100 },
      { id: 'drink', stationId: 'bar', productId: null, categoryId: 'drink', priority: 100 },
      { id: 'coffee', stationId: 'coffee', productId: 'coffee', categoryId: null, priority: 100 },
    ]);
    expect(result).toEqual([
      { lineId: 'line-coffee', stationId: 'coffee', routeId: 'coffee', status: 'queued' },
      { lineId: 'line-food', stationId: 'expo', routeId: 'default', status: 'queued' },
    ]);
  });

  it('creates an explicit exception for a preparation line without a route', () => {
    expect(resolveKitchenRoutes([lines[0]], [])).toEqual([
      { lineId: 'line-coffee', stationId: null, routeId: null, status: 'exception' },
    ]);
  });

  it('does not route a product that needs no preparation', () => {
    expect(resolveKitchenRoutes([lines[2]], [])).toEqual([]);
  });

  it('allows an explicit route to mark a product as preparation work', () => {
    expect(
      resolveKitchenRoutes(
        [lines[2]],
        [{ id: 'beans', stationId: 'coffee', productId: 'beans', categoryId: null, priority: 10 }],
      ),
    ).toEqual([{ lineId: 'line-retail', stationId: 'coffee', routeId: 'beans', status: 'queued' }]);
  });

  it('uses route id as a deterministic tie breaker', () => {
    const result = resolveKitchenRoutes(
      [lines[0]],
      [
        { id: 'b', stationId: 'bar-b', productId: 'coffee', categoryId: null, priority: 10 },
        { id: 'a', stationId: 'bar-a', productId: 'coffee', categoryId: null, priority: 10 },
      ],
    );
    expect(result[0]?.stationId).toBe('bar-a');
  });
});

describe('kitchen lifecycle', () => {
  it('derives partial readiness from item state', () => {
    expect(deriveKitchenOrderStatus(['ready', 'preparing'])).toBe('partially_ready');
    expect(deriveKitchenOrderStatus(['ready', 'cancelled'])).toBe('ready');
    expect(deriveKitchenOrderStatus(['cancelled', 'cancelled'])).toBe('cancelled');
  });

  it('blocks terminal regression and permits an explicit recall', () => {
    expect(validateKitchenTransition('completed', 'in_preparation', false)).toBe(
      'KITCHEN_INVALID_TRANSITION',
    );
    expect(validateKitchenTransition('ready', 'in_preparation', true)).toBeNull();
  });
});

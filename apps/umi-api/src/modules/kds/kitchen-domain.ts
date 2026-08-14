export type KitchenOrderStatus =
  | 'queued'
  | 'in_preparation'
  | 'partially_ready'
  | 'ready'
  | 'completed'
  | 'cancelled'
  | 'exception';

export type KitchenItemStatus = 'queued' | 'preparing' | 'ready' | 'cancelled' | 'exception';

export interface KitchenRouteLine {
  id: string;
  productId: string | null;
  categoryId: string | null;
  requiresPreparation: boolean;
}

export interface KitchenRouteCandidate {
  id: string;
  stationId: string;
  productId: string | null;
  categoryId: string | null;
  priority: number;
}

export interface KitchenRouteResult {
  lineId: string;
  stationId: string | null;
  routeId: string | null;
  status: KitchenItemStatus;
}

export function resolveKitchenRoutes(
  lines: readonly KitchenRouteLine[],
  routes: readonly KitchenRouteCandidate[],
): KitchenRouteResult[] {
  return lines.flatMap((line) => {
    const candidates = routes
      .filter(
        (route) =>
          route.productId === line.productId ||
          (route.productId === null && route.categoryId === line.categoryId) ||
          (route.productId === null && route.categoryId === null),
      )
      .sort((left, right) => {
        const precedence = routePrecedence(left, line) - routePrecedence(right, line);
        if (precedence !== 0) return precedence;
        if (left.priority !== right.priority) return left.priority - right.priority;
        return left.id.localeCompare(right.id);
      });
    const explicitPreparationRoute = candidates.some(
      (route) =>
        (route.productId !== null && route.productId === line.productId) ||
        (route.categoryId !== null && route.categoryId === line.categoryId),
    );
    if (!line.requiresPreparation && !explicitPreparationRoute) return [];
    const route = candidates[0];
    return [
      route
        ? { lineId: line.id, stationId: route.stationId, routeId: route.id, status: 'queued' }
        : { lineId: line.id, stationId: null, routeId: null, status: 'exception' },
    ];
  });
}

function routePrecedence(route: KitchenRouteCandidate, line: KitchenRouteLine): number {
  if (route.productId === line.productId && route.productId !== null) return 0;
  if (route.categoryId === line.categoryId && route.categoryId !== null) return 1;
  return 2;
}

export function deriveKitchenOrderStatus(
  itemStatuses: readonly KitchenItemStatus[],
): KitchenOrderStatus {
  if (itemStatuses.length === 0) return 'exception';
  if (itemStatuses.every((status) => status === 'cancelled')) return 'cancelled';
  if (itemStatuses.some((status) => status === 'exception')) return 'exception';
  const active = itemStatuses.filter((status) => status !== 'cancelled');
  if (active.every((status) => status === 'ready')) return 'ready';
  if (active.some((status) => status === 'ready')) return 'partially_ready';
  if (active.some((status) => status === 'preparing')) return 'in_preparation';
  return 'queued';
}

const TRANSITIONS: Readonly<Record<KitchenOrderStatus, readonly KitchenOrderStatus[]>> = {
  queued: ['in_preparation', 'partially_ready', 'ready', 'cancelled', 'exception'],
  in_preparation: ['partially_ready', 'ready', 'cancelled', 'exception'],
  partially_ready: ['in_preparation', 'ready', 'cancelled', 'exception'],
  ready: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
  exception: ['queued', 'in_preparation', 'cancelled'],
};

export function validateKitchenTransition(
  current: KitchenOrderStatus,
  target: KitchenOrderStatus,
  recall: boolean,
): 'KITCHEN_INVALID_TRANSITION' | null {
  if (recall && current === 'ready' && target === 'in_preparation') return null;
  return TRANSITIONS[current].includes(target) ? null : 'KITCHEN_INVALID_TRANSITION';
}

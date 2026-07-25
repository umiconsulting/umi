import { describe, expect, it } from 'vitest';
import {
  mapKitchenToOrderStatus,
  mapOrderToKitchenStatus,
  type KitchenStatus,
  type OrderStatus,
} from './kds-contract';

/**
 * The KDS status vocabulary guard.
 *
 * These two lists are TRANSCRIBED from things this test cannot import:
 *   ORDER_STATUSES   = the CHECK on tenant.customer_order.status (20_tenant.sql)
 *   KITCHEN_STATUSES = the Swift enum KitchenStatus (apps/umi-kds KitchenModels.swift)
 *
 * That is the whole point. A Postgres CHECK and a Swift enum have no common type
 * system, no shared build, and no gate that reads both — sql-preflight happily
 * resolves `o.status` while the value inside it is one the iPad cannot decode. The
 * only place the two vocabularies can be held against each other is here.
 *
 * If either side changes, a test here must fail. If someone adds a status to the
 * CHECK and not to this list, the DB-side test below is the one that will not catch
 * it — so the list is duplicated deliberately, with its source named.
 */
const ORDER_STATUSES: OrderStatus[] = ['placed', 'preparing', 'ready', 'completed', 'canceled'];

const KITCHEN_STATUSES: KitchenStatus[] = [
  'new',
  'accepted',
  'preparing',
  'ready',
  'completed',
  'cancelled',
  'partial_cancelled',
];

describe('KDS status vocabulary — build-v3 → iPad (the board-killer guard)', () => {
  it('maps EVERY status the CHECK permits to a value the frozen Swift enum accepts', () => {
    for (const s of ORDER_STATUSES) {
      expect(KITCHEN_STATUSES, `"${s}" mapped outside the frozen enum`).toContain(
        mapOrderToKitchenStatus(s),
      );
    }
  });

  it('maps the two the iPad cannot decode raw', () => {
    // KitchenStatus(rawValue: "placed") and ("canceled") are both nil in Swift, and
    // asKitchenOrder() throws on nil — inside a `try rows.map`, which blanks the board.
    expect(mapOrderToKitchenStatus('placed')).toBe('new');
    expect(mapOrderToKitchenStatus('canceled')).toBe('cancelled');
  });

  it('passes through the three that already agree', () => {
    expect(mapOrderToKitchenStatus('preparing')).toBe('preparing');
    expect(mapOrderToKitchenStatus('ready')).toBe('ready');
    expect(mapOrderToKitchenStatus('completed')).toBe('completed');
  });

  it('falls back to a decodable value rather than an undecodable one', () => {
    // A mislabelled ticket beats a blank board. Unreachable while the CHECK and the
    // switch agree, but the failure mode is asymmetric enough to pin.
    expect(KITCHEN_STATUSES).toContain(mapOrderToKitchenStatus('something_new'));
  });
});

describe('KDS status vocabulary — iPad → build-v3 (the write path)', () => {
  it('maps EVERY frozen enum value to a value the CHECK permits', () => {
    for (const k of KITCHEN_STATUSES) {
      expect(ORDER_STATUSES, `"${k}" mapped outside the CHECK`).toContain(
        mapKitchenToOrderStatus(k),
      );
    }
  });

  it('collapses accepted + partial_cancelled onto preparing (owner, 2026-07-24)', () => {
    expect(mapKitchenToOrderStatus('accepted')).toBe('preparing');
    expect(mapKitchenToOrderStatus('partial_cancelled')).toBe('preparing');
    expect(mapKitchenToOrderStatus('preparing')).toBe('preparing');
  });

  it('round-trips every status that has NOT been collapsed', () => {
    // The collapse is the one documented lossy edge; everything else must survive a
    // full trip, or a ticket changes column on the next poll for no reason.
    const collapsed: KitchenStatus[] = ['accepted', 'partial_cancelled'];
    for (const k of KITCHEN_STATUSES.filter((s) => !collapsed.includes(s))) {
      expect(mapOrderToKitchenStatus(mapKitchenToOrderStatus(k)), `"${k}" did not survive`).toBe(k);
    }
  });
});

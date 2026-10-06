import { describe, expect, it } from 'vitest';
import {
  ORDER_STATUSES,
  mapKitchenToOrderStatus,
  mapOrderToKitchenStatus,
  type KitchenStatus,
} from './kds-contract';

/**
 * The KDS status vocabulary guard — the middle link of a three-sided chain.
 *
 *   merchant.customer_order.status  (Postgres CHECK)
 *          ↕  check-values.integration.ts · "$table · $column … exact"
 *   ORDER_STATUSES                  (TypeScript)
 *          ↕  THIS FILE
 *   KitchenStatus                   (Swift enum, apps/umi-kds KitchenModels.swift)
 *
 * `ORDER_STATUSES` is now IMPORTED rather than transcribed. It used to be copied here
 * with a comment saying this test could not reach the CHECK — true then, and the
 * copy's cost was that adding a status to the database left both the constant and this
 * list untouched and every test green. The integration gate closed that: it holds the
 * constant against the live CHECK on every CI round, so importing it makes this file's
 * claims transitive to the database instead of parallel to it.
 *
 * `KITCHEN_STATUSES` stays transcribed, and must. A Swift enum has no representation
 * this process can import — no shared type system, no shared build. That side is
 * checked by a person reading two files, which is exactly why the frozen client's
 * vocabulary is the one written out longhand here.
 */
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

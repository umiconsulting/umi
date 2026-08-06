import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  resolve(process.cwd(), '../../docs/migration/build-v3/36_pos_inventory.sql'),
  'utf8',
);
const checkout = readFileSync(
  resolve(process.cwd(), 'src/modules/pos-checkout/pos-checkout.repository.ts'),
  'utf8',
);
const exceptions = readFileSync(
  resolve(process.cwd(), 'src/modules/pos-exception/pos-exception.repository.ts'),
  'utf8',
);
const inventory = readFileSync(
  resolve(process.cwd(), 'src/modules/pos-inventory/pos-inventory.repository.ts'),
  'utf8',
);
const rls = readFileSync(
  resolve(process.cwd(), '../../docs/migration/build-v3/90_rls.sql'),
  'utf8',
);

describe('Gate 3E inventory authority', () => {
  it('stores immutable facts and rebuilds the balance from the ledger', () => {
    expect(sql).toContain('create table merchant.stock_ledger_entry');
    expect(sql).toContain('Append-only physical stock facts');
    expect(sql).toContain('create or replace function merchant.rebuild_stock_balance');
    expect(sql).not.toMatch(/update merchant\.stock_ledger_entry/i);
    expect(sql).not.toMatch(/delete from merchant\.stock_ledger_entry/i);
  });

  it('keeps on-hand, reserved, committed, and unavailable states separate', () => {
    for (const column of [
      'on_hand bigint',
      'reserved bigint',
      'committed bigint',
      'damaged bigint',
      'quarantine bigint',
      'waste bigint',
    ]) {
      expect(sql).toContain(column);
    }
    expect(sql).toContain(
      'available bigint generated always as (on_hand-reserved-quarantine-damaged)',
    );
  });

  it('commits the sale and its stock effects in one checkout transaction', () => {
    expect(checkout).toContain('merchant.commit_sale_inventory');
    expect(checkout).toContain('merchant.commit_sale_inventory');
    expect(checkout).toContain('await client.query');
    expect(sql).toContain("'sale_committed'");
    expect(sql).toContain("status='committed'");
  });

  it('expires stale reservations before checkout can refresh one', () => {
    const sweep = checkout.indexOf('expire_inventory_reservations');
    const refresh = checkout.indexOf('INSERT INTO merchant.inventory_reservation');
    expect(sweep).toBeGreaterThan(-1);
    expect(refresh).toBeGreaterThan(sweep);
  });

  it('consumes the immutable refund intent without automatic recipe restock', () => {
    expect(exceptions).not.toContain('merchant.consume_pos_restock_intent');
    expect(inventory).toContain("'inventory.restock.approve'");
    expect(inventory).toContain("outcome='review_required'");
    expect(inventory).toContain("terminal.outcome<>'review_required'");
    expect(inventory).not.toContain('UPDATE merchant.pos_restock_intent');
    expect(inventory).toContain('RESTOCK_EXCEEDS_ORIGINAL_CONSUMPTION');
    expect(sql).toContain("'component_resolved'");
  });

  it('binds consequential inventory approval to one command', () => {
    expect(inventory).toContain('command_fingerprint=$5');
    expect(inventory).toContain('consumed_by_command_id=$6::uuid');
    expect(inventory).toContain('consumed_at IS NULL');
    expect(inventory).toContain('APPROVAL_FINGERPRINT_MISMATCH');
  });

  it('uses explicit merchant and location RLS', () => {
    expect(sql).toContain('enable row level security');
    expect(sql).toContain('force row level security');
    expect(rls).toContain("'stock_ledger_entry'");
    expect(rls).toMatch(
      /not_device_scoped constant text\[\] := array\[\s*'stock_ledger_entry'/,
    );
    expect(rls).toContain('location_id = umi.current_location()');
  });

  it('limits stock authority functions to scoped service roles', () => {
    expect(sql).toContain('from public,readonly');
    expect(sql).toContain('INVENTORY_CONTEXT_REQUIRED');
    expect(sql).toContain('to api,worker');
  });

  it('binds policy, balance versions, and count snapshots to current authority', () => {
    expect(inventory).toContain('INVENTORY_POLICY_CHANGED');
    expect(inventory).toContain('INVENTORY_VERSION_CHANGED');
    expect(sql).toContain('snapshot_item_sequences jsonb');
    expect(inventory).toContain('snapshot_item_sequences AS "snapshotItemSequences"');
  });

  it('uses deterministic lock order for item mutations', () => {
    expect(sql).toContain('order by inventory_item_id,sale_line_id');
    expect(sql).toContain('for update;');
    expect(sql).toContain('unique nulls not distinct');
  });

  it('releases expired reservations through an explicit idempotent command', () => {
    expect(sql).toContain('create or replace function merchant.expire_inventory_reservations');
    expect(sql).toContain("merchant.release_inventory_reservation(r.id,'reservation_expired')");
    expect(inventory).toContain('merchant.expire_inventory_reservations');
    expect(checkout).toContain('merchant.expire_inventory_reservations');
  });

  it('keeps every inventory relation inside one merchant', () => {
    for (const relation of [
      'pos_committed_sale(merchant_id, id)',
      'pos_cart_line(merchant_id, id)',
      'pos_sale_exception(merchant_id, id)',
      'inventory_reservation(merchant_id, id)',
      'pos_restock_intent(merchant_id, id)',
      'inventory_count(merchant_id, id)',
    ]) {
      expect(sql).toContain(`references merchant.${relation}`);
    }
  });

  it('paginates history and preserves modifier quantities', () => {
    expect(inventory).toContain('(occurred_at,id)<($5::timestamptz,$6::uuid)');
    expect(inventory).toContain("Buffer.from(query.cursor, 'base64url')");
    expect(checkout).toContain('coalesce(selected_modifier.quantity,1)');
    expect(inventory).toContain('r.yield_quantity*rc.conversion_denominator');
  });

  it('requires a consumed command-bound approval for negative stock override', () => {
    expect(sql).toContain("g.permission_key='inventory.negative_stock.override'");
    expect(sql).toContain('g.command_fingerprint=p_fingerprint');
    expect(sql).toContain('g.consumed_by_command_id=p_command_id');
    expect(sql).toContain("raise exception 'NEGATIVE_STOCK_APPROVAL_REQUIRED'");
  });
});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  resolve(process.cwd(), '../../docs/migration/build-v3/34_pos_exception.sql'),
  'utf8',
);
const repository = readFileSync(
  resolve(process.cwd(), 'src/modules/pos-exception/pos-exception.repository.ts'),
  'utf8',
);

describe('Gate 3D exception persistence', () => {
  it('keeps every original financial table outside exception mutation statements', () => {
    expect(repository).not.toMatch(/UPDATE merchant\.pos_committed_sale/);
    expect(repository).not.toMatch(/UPDATE merchant\.receipt_snapshot/);
    expect(repository).not.toMatch(/UPDATE merchant\.pos_tender_fact/);
    expect(repository).not.toMatch(/DELETE FROM merchant\./);
  });

  it('stores all compensation as append-only facts', () => {
    for (const table of [
      'pos_sale_exception',
      'pos_sale_exception_line',
      'pos_tender_compensation',
      'pos_cash_compensation',
      'pos_restock_intent',
      'pos_exception_receipt',
    ]) {
      expect(sql).toContain(table);
    }
    expect(sql).toContain('post-sale compensation is append-only');
  });

  it('blocks cumulative line and tender over-refunds', () => {
    expect(sql).toContain('tg_pos_exception_line_limit');
    expect(sql).toContain('prior_quantity+new.compensated_quantity>source_quantity');
    expect(sql).toContain('tg_pos_tender_compensation_limit');
    expect(sql).toContain('prior_amount+new.amount_minor_units>source_amount');
    expect(sql).toContain('source_discount<>new.original_discount_minor_units');
  });

  it('binds cash compensation to the current shift and register', () => {
    expect(sql).toContain('current_shift_id uuid not null');
    expect(sql).toContain('current_register_id uuid not null');
    expect(repository).toContain("s.status='open'");
    expect(repository).toContain("'cash_refund'");
    expect(repository).toContain("${lock ? 'FOR UPDATE OF s' : ''}");
    expect(repository).toContain('const nextSequence = shift.ledgerSequence + 1');
    expect(repository.indexOf('INSERT INTO merchant.cash_ledger_entry')).toBeLessThan(
      repository.indexOf('UPDATE merchant.cash_shift SET ledger_sequence'),
    );
    expect(sql).toContain('cash refund binding mismatch');
  });

  it('enables and forces merchant and location RLS', () => {
    expect(sql).toContain('enable row level security');
    expect(sql).toContain('force row level security');
    expect(sql).toContain(
      'merchant_id=umi.current_merchant() and location_id=umi.current_location()',
    );
  });

  it('stores restock intent without inventory mutation', () => {
    expect(sql).toContain("inventory_status text not null default 'intent_only'");
    expect(repository).not.toMatch(/UPDATE merchant\.inventory/);
    expect(repository).not.toMatch(/INSERT INTO merchant\.inventory_/);
  });

  it('binds approval to one command fingerprint', () => {
    expect(repository).toContain('e.command_fingerprint=$5');
    expect(repository).toContain('e.consumed_at IS NULL');
    expect(repository).toContain('consumed_by_command_id=$2::uuid');
  });

  it('preserves unknown terminal outcomes as immutable query-only states', () => {
    expect(repository).toContain(
      "row.status === 'confirmed_success' || row.status === 'outcome_unknown'",
    );
    expect(repository).toContain("const queryOnly = dto.outcome === 'outcome_unknown'");
    expect(sql).toContain('tg_pos_exception_preview_transition');
    expect(sql).toContain('terminal refund outcome is immutable');
  });

  it('uses truncation and a final-line remainder for legacy allocations', () => {
    expect(sql).toContain('floor((order_discount::numeric*');
    expect(sql).toContain('floor((receipt_tip::numeric*');
    expect(sql).toContain('source_tip:=receipt_tip-prior_tip_share');
  });

  it('keeps every preview authority field immutable after creation', () => {
    expect(sql).toContain('new.approval_required is distinct from old.approval_required');
    expect(sql).toContain(
      'new.remaining_after_minor_units is distinct from old.remaining_after_minor_units',
    );
    expect(sql).toContain('new.correlation_id is distinct from old.correlation_id');
  });

  it('uses one command identity for idempotent exception commits', () => {
    expect(sql).toContain('unique(merchant_id,command_id)');
    expect(sql).toContain('unique(merchant_id,idempotency_key)');
    expect(repository).toContain('sale_id=$3::uuid AND preview_fingerprint=$5 FOR UPDATE');
  });

  it('creates an immutable compensating receipt without replacing the original receipt', () => {
    expect(sql).toContain('original_receipt_id uuid not null');
    expect(sql).toContain('tg_pos_exception_append_only');
    expect(repository).toContain('INSERT INTO merchant.pos_exception_receipt');
  });
});

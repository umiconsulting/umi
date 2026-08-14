import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  resolve(process.cwd(), '../../docs/migration/build-v3/32_pos_checkout.sql'),
  'utf8',
);
const repository = readFileSync(
  resolve(process.cwd(), 'src/modules/pos-checkout/pos-checkout.repository.ts'),
  'utf8',
);

describe('Gate 3B checkout persistence', () => {
  it('keeps one recoverable checkout for each sale', () => {
    expect(sql).toContain('unique(merchant_id,cart_id)');
    expect(sql).toContain('pos_checkout_terminal_immutable');
    expect(repository).toContain('ON CONFLICT(merchant_id,cart_id) DO UPDATE SET');
  });

  it('keeps committed tender facts immutable and exactly valued', () => {
    expect(sql).toContain('amount_minor_units between 1 and 9007199254740991');
    expect(sql).toContain('pos_tender_committed_immutable');
    expect(sql).toContain('unique(checkout_id,position)');
  });

  it('binds one-use approvals to the command fingerprint', () => {
    expect(sql).toContain('command_fingerprint text');
    expect(sql).toContain('consumed_by_command_id uuid');
    expect(repository).toContain('command_fingerprint=$6');
    expect(repository).toContain('consumed_at IS NULL');
    expect(sql).toContain("'checkout.terminal.approve'");
    expect(sql).toContain("and p.key in ('checkout.discount.apply','checkout.terminal.confirm')");
  });

  it('enables and forces merchant and location RLS for all checkout state', () => {
    for (const table of ['pos_checkout_policy', 'pos_checkout_draft', 'pos_tender_fact']) {
      expect(sql).toContain(`alter table merchant.${table} enable row level security`);
      expect(sql).toContain(`alter table merchant.${table} force row level security`);
    }
    expect(sql).toContain(
      'merchant_id=umi.current_merchant() and location_id=umi.current_location()',
    );
  });
});

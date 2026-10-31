import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(
    __dirname,
    '../../../../../supabase/migrations/20261030010000_inventory_initial_cost.sql',
  ),
  'utf8',
);
const ci = readFileSync(
  resolve(__dirname, '../../../../../.github/workflows/umi-api-ci.yml'),
  'utf8',
);

describe('initial inventory cost migration', () => {
  it('adds a nullable safe amount with a guarded constraint in one transaction', () => {
    expect(migration).toMatch(/^BEGIN;/);
    expect(migration).toMatch(/COMMIT;\s*$/);
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS initial_unit_cost_minor bigint');
    expect(migration).toContain("conrelid='merchant.inventory_item'::regclass");
    expect(migration).toContain("conname='inventory_item_initial_unit_cost_ck'");
    expect(migration).toContain('initial_unit_cost_minor IS NULL');
    expect(migration).toContain('initial_unit_cost_minor BETWEEN 0 AND 9007199254740991');
    expect(migration).not.toMatch(/DEFAULT|UPDATE|stock_ledger|stock_balance/i);
  });
  it('runs in fresh CI and twice after populated CI data', () => {
    expect(
      ci.match(/-f supabase\/migrations\/20261030010000_inventory_initial_cost.sql/g),
    ).toHaveLength(3);
  });
});

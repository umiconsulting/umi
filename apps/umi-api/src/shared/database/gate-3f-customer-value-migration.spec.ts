import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  resolve(process.cwd(), '../../docs/migration/build-v3/37_pos_customer_value.sql'),
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
const customerValueRepository = readFileSync(
  resolve(process.cwd(), 'src/modules/pos-customer-value/pos-customer-value.repository.ts'),
  'utf8',
);
const cashWriteRepository = readFileSync(
  resolve(process.cwd(), 'src/modules/cash/cash-write.repository.ts'),
  'utf8',
);
const rls = readFileSync(
  resolve(process.cwd(), '../../docs/migration/build-v3/90_rls.sql'),
  'utf8',
);

describe('Gate 3F customer and value authority', () => {
  it('keeps customer identity inside one merchant', () => {
    expect(sql).toContain('customer_merchant_id_uk unique (merchant_id,id)');
    expect(sql).toContain('references merchant.customer(merchant_id,id)');
    expect(sql).toContain('CUSTOMER_MERCHANT_SCOPE');
  });

  it('stores immutable consent, points, wallet, and gift-card facts', () => {
    for (const table of [
      'customer_consent_history',
      'loyalty_points_ledger',
      'loyalty_stored_value_ledger',
      'loyalty_gift_card_ledger',
    ]) {
      expect(sql).toContain(table);
    }
    expect(sql).toContain('customer_consent_history_append_only');
    expect(sql).toContain('loyalty_points_ledger_append_only');
    expect(sql).toContain('stored_value_ledger_append_only');
    expect(sql).toContain('gift_card_ledger_append_only');
    expect(rls).toContain('merchant.loyalty_points_ledger');
    expect(rls).toContain('from api, worker');
    expect(sql).toContain('append_stored_value_fact');
    expect(sql).toContain('append_gift_card_fact');
    expect(customerValueRepository).not.toMatch(
      /INSERT INTO merchant\.loyalty_(stored_value|gift_card)_ledger/,
    );
    expect(cashWriteRepository).not.toMatch(
      /INSERT INTO merchant\.loyalty_(stored_value|gift_card)_ledger/,
    );
  });

  it('protects gift-card lookup secrets', () => {
    expect(sql).toContain('code_hash bytea');
    expect(sql).toContain('extensions.digest');
    expect(sql).toContain('GIFT_CARD_CODE_PLAINTEXT_FORBIDDEN');
    expect(sql).not.toMatch(/add column code_plaintext/i);
  });

  it('uses one-use account and command-bound authorizations', () => {
    expect(sql).toContain('create table merchant.customer_value_authorization');
    expect(sql).toContain('unique (merchant_id,command_id)');
    expect(sql).toContain('checkout_fingerprint');
    expect(sql).toContain(
      "status in ('authorized','committed','released','expired','declined','conflict','reversed')",
    );
    expect(customerValueRepository).toContain('consumed_by_command_id=$6::uuid');
    expect(customerValueRepository).toContain('approved_by<>$8::uuid');
    expect(customerValueRepository).toContain("method='manager_approval'");
    expect(sql).toContain('benefit_minor_units');
    expect(checkout).toContain('a.benefit_minor_units');
  });

  it('commits sale, loyalty, inventory, and stored value together', () => {
    expect(checkout).toContain('merchant.commit_customer_value');
    expect(checkout).toContain('merchant.commit_sale_inventory');
    expect(sql).toContain('create or replace function merchant.commit_customer_value');
  });

  it('reverses value with the immutable refund command', () => {
    expect(exceptions).toContain('merchant.reverse_customer_value');
    expect(sql).toContain('create or replace function merchant.reverse_customer_value');
    expect(sql).toContain('VALUE_REVERSAL_EXCEEDS_ORIGINAL');
  });

  it('enables and forces merchant RLS', () => {
    expect(sql).toContain('enable row level security');
    expect(sql).toContain('force row level security');
    expect(sql).toContain('location_id = umi.current_location()');
  });

  it('fails closed for merged profiles with value accounts', () => {
    expect(sql).toContain('VALUE_RECONCILIATION_REQUIRED');
    expect(sql).toContain('most restrictive consent');
  });
});

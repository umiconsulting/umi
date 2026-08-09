import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  resolve(process.cwd(), '../../docs/migration/build-v3/37_pos_customer_value.sql'),
  'utf8',
);
const closeout = readFileSync(
  resolve(process.cwd(), '../../docs/migration/build-v3/38_pos_customer_value_closeout.sql'),
  'utf8',
);
const finalCloseout = readFileSync(
  resolve(process.cwd(), '../../docs/migration/build-v3/39_pos_customer_value_final_closeout.sql'),
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

  it('binds immutable loyalty policy and earn preview facts to the sale', () => {
    expect(closeout).toContain('loyalty_sale_policy_snapshot');
    expect(closeout).toContain('loyalty_earn_preview');
    expect(closeout).toContain('loyalty_sale_policy_snapshot_append_only');
    expect(closeout).toContain('LOYALTY_PREVIEW_STALE');
  });

  it('expires every authorization through one exact-release command', () => {
    expect(closeout).toContain('expire_customer_value_authorizations');
    expect(closeout).toContain('skip locked');
    expect(closeout).toContain("status='expired'");
    expect(closeout).toContain('authorization_released');
    expect(closeout).toContain('points_released');
  });

  it('supports secure adjustment, issuance, abuse control, and composite history', () => {
    expect(closeout).toContain('preview_points_adjustment');
    expect(closeout).toContain('commit_points_adjustment');
    expect(closeout).toContain('gift_card_secret_delivery');
    expect(closeout).toContain('gift_card_lookup_attempt');
    expect(closeout).toContain('customer_history_event');
    expect(closeout).toContain('CUSTOMER_HISTORY_CURSOR_INVALID');
    expect(closeout).toContain('store_gift_card_secret_delivery');
    expect(closeout).toContain('reveal_gift_card_secret_delivery');
    expect(closeout).toContain("g.status='active'");
    expect(closeout).toContain("g.issuance_source<>'sale' or g.activated_by_sale_id is not null");
    expect(closeout).not.toContain('grant select,insert,update on merchant.loyalty_earn_preview');
  });

  it('binds the final checkout and commits anonymous gift-card tenders', () => {
    expect(closeout).toContain('merchant.assert_loyalty_earn_preview');
    expect(closeout).toContain('p_checkout_version');
    expect(closeout).toContain('p_checkout_fingerprint');
    expect(closeout).toContain("v_auth.account_type='wallet'");
    expect(closeout).toContain('WALLET_CUSTOMER_REQUIRED');
    expect(finalCloseout).toContain("a.account_type='gift_card'");
    expect(finalCloseout).toContain('merchant.append_gift_card_fact');
    expect(finalCloseout).toContain('STORED_VALUE_FINGERPRINT_CONFLICT');
    expect(customerValueRepository).not.toContain('GIFT_CARD_SALE_ISSUANCE_NOT_AVAILABLE');
  });

  it('stores immutable tender allocation, funded activation, and explicit history scope', () => {
    expect(finalCloseout).toContain('customer_value_tender_allocation');
    expect(finalCloseout).toContain('gift_card_funding_assignment');
    expect(finalCloseout).toContain('customer_history_event_scoped');
    expect(finalCloseout).toContain('restricted_administrative');
    expect(finalCloseout).toContain('read_customer_history_event_scoped');
    expect(finalCloseout).toContain('p_operator_session_id uuid');
    expect(finalCloseout).toContain("'customer.history.admin'=any(os.permissions)");
    expect(finalCloseout).toContain(
      "os.user_id=nullif(current_setting('app.user_id',true),'')::uuid",
    );
    expect(finalCloseout).toContain('activate_sale_funded_gift_card');
    expect(finalCloseout).toContain("then 'wallet_'||e.event_type");
    expect(finalCloseout).toContain('customer_value_one_live_account_allocation_uidx');
    expect(finalCloseout).toContain("product.sale_action='gift_card'");
    expect(finalCloseout).toContain("'gift-card-sale-funding','pilot-v1'");
    expect(finalCloseout).toContain('A null location never acts as a location wildcard');
    expect(finalCloseout).toContain(
      'uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,integer,text,date,uuid,uuid,jsonb',
    );
    expect(finalCloseout).toContain('from public,api,worker,readonly');
  });

  it('binds every closeout relation to the same merchant', () => {
    expect(closeout).toContain('references merchant.location(merchant_id,id)');
    expect(closeout).toContain('references merchant.pos_cart(merchant_id,id)');
    expect(closeout).toContain('references merchant.loyalty_earn_preview(merchant_id,id)');
    expect(closeout).toContain('references merchant.device(merchant_id,id)');
  });

  it('fails closed for consent merge conflicts and location history', () => {
    expect(customerValueRepository).toContain('customer_consent_current');
    expect(customerValueRepository).toContain('is distinct from');
    expect(customerValueRepository).toContain(
      "visibility IN ('location_attributed','origin_location')",
    );
  });
});

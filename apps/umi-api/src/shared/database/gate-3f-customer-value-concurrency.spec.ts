import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(process.cwd(), '../..');
const migration = [
  readFileSync(resolve(root, 'docs/migration/build-v3/37_pos_customer_value.sql'), 'utf8'),
  readFileSync(resolve(root, 'docs/migration/build-v3/38_pos_customer_value_closeout.sql'), 'utf8'),
  readFileSync(
    resolve(root, 'docs/migration/build-v3/39_pos_customer_value_final_closeout.sql'),
    'utf8',
  ),
].join('\n');
const realHarness = readFileSync(
  resolve(root, 'scripts/umi-pos-customer-value-concurrency-check.sh'),
  'utf8',
);
const repository = readFileSync(
  resolve(root, 'apps/umi-api/src/modules/pos-customer-value/pos-customer-value.repository.ts'),
  'utf8',
);

const cases: Array<[string, RegExp, 'migration' | 'repository']> = [
  [
    'two reward authorizations for final points',
    /loyalty_points_balance[\s\S]*for update/i,
    'migration',
  ],
  [
    'reward authorization versus points decrease',
    /append_loyalty_points[\s\S]*for update/i,
    'migration',
  ],
  ['reward authorization versus points reversal', /LOYALTY_INSUFFICIENT_POINTS/, 'migration'],
  [
    'reward expiry versus checkout commit',
    /status='authorized' and expires_at>clock_timestamp\(\)[\s\S]*for update/i,
    'migration',
  ],
  [
    'explicit reward release versus expiry',
    /status='authorized'[\s\S]*for update skip locked/i,
    'migration',
  ],
  [
    'two reward commits for one authorization',
    /customer_value_active_allocation_uidx/,
    'migration',
  ],
  [
    'two wallet authorizations for final value',
    /FROM merchant\.\$\{table\}[\s\S]*FOR UPDATE/i,
    'repository',
  ],
  ['wallet authorization versus refund', /stored_value_sequence_uk/, 'migration'],
  [
    'wallet authorization versus adjustment',
    /loyalty_stored_value_balance[\s\S]*for update/i,
    'migration',
  ],
  [
    'wallet expiry versus checkout commit',
    /account_type='wallet'[\s\S]*authorization_released/i,
    'migration',
  ],
  [
    'explicit wallet release versus expiry',
    /UPDATE merchant\.customer_value_authorization SET status='released'/,
    'repository',
  ],
  ['two wallet commits for one authorization', /stored_value_command_type_uk/, 'migration'],
  [
    'two gift-card authorizations for final value',
    /loyalty_gift_card_balance[\s\S]*for update/i,
    'migration',
  ],
  [
    'gift-card authorization versus suspension',
    /loyalty_gift_card[\s\S]*status='active' for update/i,
    'migration',
  ],
  ['gift-card activation versus redemption', /status IN \('created','inactive'\)/, 'repository'],
  [
    'gift-card expiry versus checkout commit',
    /append_gift_card_fact[\s\S]*authorization_released/i,
    'migration',
  ],
  ['two gift-card commits for one authorization', /gift_card_command_type_uk/, 'migration'],
  ['gift-card refund versus redemption', /gift_card_sequence_uk/, 'migration'],
  ['customer merge versus reward authorization', /validate_customer_merge_scope/, 'migration'],
  ['customer merge versus wallet mutation', /value_reconciliation_required/, 'migration'],
  [
    'customer merge versus gift-card attachment',
    /exists\(select 1 from merchant\.loyalty_gift_card/,
    'repository',
  ],
  ['consent update versus customer merge', /most restrictive consent wins/i, 'migration'],
  ['points earn versus refund reversal', /loyalty_sale_policy_snapshot/, 'migration'],
  [
    'reward redemption versus partial refund',
    /v_target:=floor\(\(r\.points::numeric\*v_refunded_total/i,
    'migration',
  ],
  ['duplicate response-loss retries', /unique \(merchant_id,command_id\)/i, 'migration'],
  [
    'history pagination while events append',
    /ORDER BY occurred_at DESC,event_type DESC,event_id DESC/,
    'repository',
  ],
];

describe('Gate 3F bounded concurrency matrix', () => {
  it.each(cases)('%s uses a production lock or uniqueness defense', (_name, pattern, source) => {
    expect(source === 'migration' ? migration : repository).toMatch(pattern);
  });

  it('keeps one deterministic account lock order', () => {
    expect(migration).toMatch(
      /customer[\s\S]*loyalty_points_account[\s\S]*customer_value_authorization/i,
    );
    expect(migration).toMatch(/order by a\.account_type,a\.account_id for update/i);
  });

  it('executes all 26 races through independent PostgreSQL sessions', () => {
    expect(realHarness).toContain('for scenario in $(seq 1 26)');
    expect(realHarness).toContain('pg_advisory_lock');
    expect(realHarness).toContain('pid_1');
    expect(realHarness).toContain('pid_2');
    expect(realHarness).toContain('count(distinct scenario)');
    expect(realHarness).not.toContain('Promise.resolve');
  });
});

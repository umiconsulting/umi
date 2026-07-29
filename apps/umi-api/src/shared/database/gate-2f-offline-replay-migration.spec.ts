import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  resolve(process.cwd(), '../../supabase/migrations/20260728000500_gate_2f_offline_replay.sql'),
  'utf8',
);
const finalCloseoutSql = readFileSync(
  resolve(process.cwd(), '../../supabase/migrations/20260728000700_gate_2f_final_closeout.sql'),
  'utf8',
);

describe('Gate 2F offline replay migration', () => {
  it('keeps replay records immutable and sequences unique per credential', () => {
    expect(sql).toContain('offline replay commands are immutable');
    expect(sql).toContain('unique (device_id, credential_version, device_sequence)');
    expect(sql).toContain('unique (business_id, idempotency_key)');
  });

  it('defaults offline cash and web-sensitive journaling to fail closed', () => {
    expect(sql).toContain('cash_sale_enabled boolean not null default false');
    expect(sql).toContain("allowed_command_types text[] not null default array['operational.ack']");
  });

  it('enables tenant RLS on all replay state', () => {
    expect(sql.match(/enable row level security/g)).toHaveLength(4);
    expect(sql).toContain('business_id = umi.current_business()');
  });

  it('fails replay closed for revoked, rotated, or mismatched authority', () => {
    expect(finalCloseoutSql).toContain("device_record.lifecycle_state <> 'active'");
    expect(finalCloseoutSql).toContain(
      'device_record.credential_version <> new.credential_version',
    );
    expect(finalCloseoutSql).toContain('operator_record.branch_id <> new.branch_id');
    expect(finalCloseoutSql).toContain('offline_replay_authority_guard');
  });
});

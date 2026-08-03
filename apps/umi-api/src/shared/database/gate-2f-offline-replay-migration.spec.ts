import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = ['20_merchant.sql', '60_triggers.sql', '90_rls.sql']
  .map((file) => readFileSync(resolve(process.cwd(), `../../docs/migration/build-v3/${file}`), 'utf8'))
  .join('\n');
const finalCloseoutSql = sql;

describe('Gate 2F offline replay migration', () => {
  it('keeps replay records immutable and sequences unique per credential', () => {
    expect(sql).toContain('The accepted commands themselves. Immutable');
    expect(sql).toContain('unique (device_id, credential_version, device_sequence)');
    expect(sql).toContain('unique (merchant_id, idempotency_key)');
  });

  it('defaults offline cash and web-sensitive journaling to fail closed', () => {
    expect(sql).toContain('cash_sale_enabled boolean not null default false');
    expect(sql).toContain("allowed_command_types text[] not null default array['operational.ack']");
  });

  it('enables merchant RLS and device scope on replay state', () => {
    expect(sql).toContain('offline_replay_command');
    expect(sql).toContain('merchant_id = umi.current_merchant()');
    expect(sql).toContain('device_scoping');
  });

  it('fails replay closed for revoked, rotated, or mismatched authority', () => {
    expect(finalCloseoutSql).toContain("device_record.status <> 'active'");
    expect(finalCloseoutSql).toContain(
      'device_record.credential_version <> new.credential_version',
    );
    expect(finalCloseoutSql).toContain('operator_record.location_id <> new.location_id');
    expect(finalCloseoutSql).toContain('offline_replay_authority_guard');
  });
});

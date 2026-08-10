import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  resolve(process.cwd(), '../../docs/migration/build-v3/43_dashboard_administrative_commands.sql'),
  'utf8',
);

describe('Gate 5A administrative command migration', () => {
  it('keeps Dashboard sessions separate from device sessions', () => {
    expect(sql).toContain('create table runtime.dashboard_session');
    expect(sql).not.toMatch(/insert into merchant\.device/i);
    expect(sql).not.toMatch(/runtime\.operator_session/i);
  });

  it('persists stable command identity and recovery state', () => {
    expect(sql).toContain('create table merchant.administrative_command');
    expect(sql).toContain('unique (merchant_id,command_id)');
    expect(sql).toContain('unique (merchant_id,idempotency_key)');
    expect(sql).toContain('fingerprint text not null');
    expect(sql).toContain("'unknown'");
  });

  it('forces merchant RLS and seals browser session rows', () => {
    expect(sql).toContain('alter table merchant.administrative_command force row level security');
    expect(sql).toContain('revoke all on runtime.dashboard_session from api,readonly');
    expect(sql).toContain("current_setting('app.user_id',true)");
  });
});

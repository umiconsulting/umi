import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  resolve(process.cwd(), '../../docs/migration/build-v3/43_dashboard_administrative_commands.sql'),
  'utf8',
);
const wiringSql = readFileSync(
  resolve(process.cwd(), '../../docs/migration/build-v3/44_dashboard_operational_wiring.sql'),
  'utf8',
);
const runnerSql = readFileSync(
  resolve(process.cwd(), '../../docs/migration/build-v3/00_run.sh'),
  'utf8',
);
const rlsSql = readFileSync(
  resolve(process.cwd(), '../../docs/migration/build-v3/90_rls.sql'),
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

  it('installs the operational wiring before RLS', () => {
    expect(runnerSql).toMatch(
      /43_dashboard_administrative_commands 44_dashboard_operational_wiring 50_cross_schema_fk/,
    );
    expect(wiringSql).toContain('administrative_command_id uuid');
    expect(wiringSql).toContain('inventory_count_command_context_ck');
    expect(wiringSql).toContain('hardware_command_actor_context_ck');
    expect(wiringSql).toContain('gift_card_delivery_context_ck');
    expect(wiringSql).toContain('approval_failed_attempts');
    expect(wiringSql).toContain("'catalog.manage'");
    expect(wiringSql).toContain("'register.manage'");
  });

  it('permits only matching administrative provenance through device RLS', () => {
    expect(rlsSql).toContain(
      "t in ('pos_exception_preview', 'pos_sale_exception', 'inventory_count')",
    );
    expect(rlsSql).toContain('ac.actor_user_id');
    expect(rlsSql).toContain("current_setting('app.user_id', true)");
  });
});

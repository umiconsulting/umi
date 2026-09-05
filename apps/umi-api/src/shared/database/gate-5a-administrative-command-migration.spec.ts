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
      /43_dashboard_administrative_commands 44_dashboard_operational_wiring 45_pilot_runtime 46_platform_bootstrap 50_cross_schema_fk/,
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
    expect(rlsSql).toContain("t = 'cash_shift'");
    expect(rlsSql).toContain("ac.operation in ('refund.preview', 'refund.commit')");
    expect(rlsSql).toContain("current_setting('app.administrative_command_id', true)");
  });

  it('scopes cash_shift device RLS to WRITES only, so owners can read shifts', () => {
    // The owner/admin Dashboard authenticates a user, not a terminal, so it never
    // sets app.current_device. If device_scoping gated SELECT on cash_shift, the
    // owner would see zero shifts — the "Caja y turnos → Turnos de caja" blank —
    // while the shift's own child facts (already not device-scoped) stayed visible.
    // Reads must fall through to merchant_isolation + location_narrowing + the
    // app-layer cash.shift.read permission; only writes stay pinned to the device
    // (or a pending refund administrative command).
    expect(rlsSql).toContain('device scoping on WRITES ONLY');
    // USING is open for cash_shift → SELECT is not device-gated.
    expect(rlsSql).toMatch(
      /create policy device_scoping on merchant\.cash_shift as restrictive\s+using \(true\)/,
    );
    // WITH CHECK still pins every INSERT/UPDATE to the acting device …
    expect(rlsSql).toContain('cash_shift.device_id = umi.current_device()');
    // … or an authorised pending refund administrative command.
    expect(rlsSql).toMatch(
      /with check \([\s\S]*ac\.operation in \('refund\.preview', 'refund\.commit'\)/,
    );
  });
});

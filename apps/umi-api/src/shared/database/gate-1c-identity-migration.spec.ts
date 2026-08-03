import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = ['20_merchant.sql', '30_runtime.sql', '90_rls.sql']
  .map((file) => readFileSync(resolve(process.cwd(), `../../docs/migration/build-v3/${file}`), 'utf8'))
  .join('\n');

describe('Gate 1C identity migration', () => {
  it('adds durable session rotation and replay state', () => {
    expect(migration).toContain('refresh_family_id');
    expect(migration).toContain('replaced_by_id');
    expect(migration).toContain('revoked_reason');
    expect(migration).toContain('session_token_hash_uidx');
  });

  it('adds append-only internal security audit state', () => {
    expect(migration).toContain('create table runtime.security_audit_event');
    expect(migration).toContain('revoke update, delete on runtime.security_audit_event');
    expect(migration).toContain('from worker');
    expect(migration).not.toMatch(/grant\s+select[^;]*runtime\.security_audit_event[^;]*\bapi\b/i);
  });

  it('adds a short-lived elevation foundation', () => {
    expect(migration).toContain('create table runtime.elevation_grant');
    expect(migration).toContain("method in ('manager_approval','operator_pin')");
    expect(migration).toContain('expires_at');
    expect(migration).toContain('consumed_at');
  });

  it('supports explicit deny on one merchant employment', () => {
    expect(migration).toContain('create table merchant.staff_permission_override');
    expect(migration).toContain("effect         text not null check (effect in ('allow','deny'))");
    expect(migration).toContain('staff_permission_override_same_merchant_fk');
  });
});

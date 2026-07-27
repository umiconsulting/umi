import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(process.cwd(), '../../supabase/migrations/20260727000100_gate_1c_identity.sql'),
  'utf8',
);

describe('Gate 1C identity migration', () => {
  it('adds durable session rotation and replay state', () => {
    expect(migration).toContain('refresh_family_id');
    expect(migration).toContain('replaced_by_id');
    expect(migration).toContain('revoked_reason');
    expect(migration).toContain('session_token_hash_uq');
  });

  it('adds append-only internal security audit state', () => {
    expect(migration).toContain('create table runtime.security_audit_event');
    expect(migration).toContain(
      'revoke update, delete on runtime.security_audit_event from worker',
    );
    expect(migration).not.toMatch(/grant\s+select[^;]*runtime\.security_audit_event[^;]*\bapi\b/i);
  });

  it('adds a short-lived elevation foundation', () => {
    expect(migration).toContain('create table runtime.elevation_grant');
    expect(migration).toContain("method in ('manager_approval', 'operator_pin')");
    expect(migration).toContain('expires_at');
    expect(migration).toContain('consumed_at');
  });

  it('supports explicit deny with bounded tenant and branch scope', () => {
    expect(migration).toContain('create table umi.user_permission_override');
    expect(migration).toContain("effect in ('allow', 'deny')");
    expect(migration).toContain('permission_override_branch_scope_ck');
    expect(migration).toContain('branch_id is null or business_id is not null');
  });
});

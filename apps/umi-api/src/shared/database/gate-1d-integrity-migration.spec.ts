import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(process.cwd(), '../../supabase/migrations/20260727000200_gate_1d_integrity.sql'),
  'utf8',
);

describe('Gate 1D integrity migration', () => {
  it('creates canonical idempotency and optimistic concurrency state', () => {
    expect(migration).toContain('create table tenant.business_command');
    expect(migration).toContain('unique (business_id, idempotency_key)');
    expect(migration).toContain('create table tenant.aggregate_version');
    expect(migration).toContain('force row level security');
  });

  it('makes audit and financial events append-only', () => {
    expect(migration).toContain('create table tenant.audit_event');
    expect(migration).toContain('create table tenant.financial_event');
    expect(migration).toContain('audit_event_append_only');
    expect(migration).toContain('financial_event_append_only');
    expect(migration).not.toMatch(
      /grant\s+update[^;]*(?:tenant\.audit_event|tenant\.financial_event)/i,
    );
  });

  it('keeps internal audit metadata unavailable to the API role', () => {
    expect(migration).toContain('create table runtime.audit_event_internal');
    expect(migration).toContain(
      'revoke select, update, delete on runtime.audit_event_internal from api',
    );
  });

  it('rejects cross-tenant branches and compensation references', () => {
    expect(migration).toContain('branch_tenant_mismatch');
    expect(migration).toContain('compensation_tenant_mismatch');
  });
});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = ['20_merchant.sql', '30_runtime.sql', '60_triggers.sql', '90_rls.sql']
  .map((file) =>
    readFileSync(resolve(process.cwd(), `../../docs/migration/build-v3/${file}`), 'utf8'),
  )
  .join('\n');

describe('Gate 1D integrity migration', () => {
  it('creates canonical idempotency and optimistic concurrency state', () => {
    expect(migration).toContain('create table merchant.business_command');
    expect(migration).toContain('unique (merchant_id, idempotency_key)');
    expect(migration).toContain('create table merchant.aggregate_version');
    expect(migration).toMatch(/force\s+row level security/);
  });

  it('makes audit and financial events append-only', () => {
    expect(migration).toContain('create table merchant.audit_event');
    expect(migration).toContain('create table merchant.financial_event');
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

  it('rejects cross-merchant locations and compensation references', () => {
    expect(migration).toContain('location_merchant_mismatch');
    expect(migration).toContain('compensation_merchant_mismatch');
  });
});

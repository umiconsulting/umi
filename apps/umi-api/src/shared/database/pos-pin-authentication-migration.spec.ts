import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  resolve(process.cwd(), '../../supabase/migrations/20260729000200_pos_pin_authentication.sql'),
  'utf8',
);

describe('UmiPOS operator PIN migration', () => {
  it('stores a keyed lookup hash and keeps the salted verifier', () => {
    expect(sql).toContain('operator_pin_lookup_hash text');
    expect(sql).toContain('existing salted scrypt hash remains the PIN verifier');
    expect(sql).not.toMatch(/\boperator_pin\s+text\b/);
  });

  it('enforces one active PIN lookup per tenant', () => {
    expect(sql).toContain('create unique index staff_operator_pin_lookup_uq');
    expect(sql).toContain('on tenant.staff (business_id, operator_pin_lookup_hash)');
    expect(sql).toContain('operator_pin_lookup_hash is not null');
  });

  it('restricts lookup hashes to a SHA-256 hexadecimal value', () => {
    expect(sql).toContain("operator_pin_lookup_hash ~ '^[a-f0-9]{64}$'");
  });
});

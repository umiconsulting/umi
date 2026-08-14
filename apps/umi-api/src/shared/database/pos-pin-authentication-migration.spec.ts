import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  resolve(process.cwd(), '../../docs/migration/build-v3/20_merchant.sql'),
  'utf8',
);

describe('UmiPOS operator PIN migration', () => {
  it('stores a keyed lookup hash and keeps the salted verifier', () => {
    expect(sql).toContain('operator_pin_lookup  text');
    expect(sql).toContain('operator_pin_hash    is that PIN right?');
    expect(sql).not.toMatch(/\boperator_pin\s+text\b/);
  });

  it('enforces one PIN lookup per merchant', () => {
    expect(sql).toContain('unique (merchant_id, operator_pin_lookup)');
  });

  it('restricts lookup hashes to a SHA-256 hexadecimal value', () => {
    expect(sql).toContain("operator_pin_lookup is null or operator_pin_lookup ~ '^[a-f0-9]{64}$'");
  });
});

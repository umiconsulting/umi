import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  resolve(process.cwd(), '../../docs/migration/build-v3/30_device_pairing.sql'),
  'utf8',
);

describe('UmiPOS device pairing migration', () => {
  it('stores only hashes for public pairing secrets and device identity', () => {
    expect(sql).toContain('setup_code_hash');
    expect(sql).toContain('polling_credential_hash');
    expect(sql).toContain('installation_hash');
    expect(sql).not.toContain('setup_code text');
    expect(sql).not.toContain('polling_credential text');
    expect(sql).not.toContain('device_credential text');
  });

  it('binds each request to one merchant and location', () => {
    expect(sql).toContain('merchant_id');
    expect(sql).toContain('location_id');
    expect(sql).toContain('device_enrollment_request_location_scope_fk');
    expect(sql).toContain('references merchant.location(merchant_id, id)');
  });

  it('enforces one session, bounded attempts, and terminal request states', () => {
    expect(sql).toContain('enrollment_request_id uuid not null unique');
    expect(sql).toContain('attempts between 0 and 5');
    expect(sql).toContain('polling_attempts between 0 and 240');
    expect(sql).toContain("'completed'");
    expect(sql).toContain("'expired'");
    expect(sql).toContain("'denied'");
  });

  it('keeps pairing records inaccessible to public API roles', () => {
    expect(sql).toContain(
      'revoke all on runtime.device_enrollment_request, runtime.device_pairing_session',
    );
    expect(sql).toContain('from public, api, readonly');
  });
});

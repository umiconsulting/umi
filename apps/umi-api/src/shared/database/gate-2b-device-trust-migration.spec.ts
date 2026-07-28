import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  resolve(process.cwd(), '../../supabase/migrations/20260728000100_gate_2b_device_trust.sql'),
  'utf8',
);

describe('Gate 2B device trust migration', () => {
  it('stores only hashes for enrollment, installation, credentials, and PINs', () => {
    expect(sql).toContain('code_hash');
    expect(sql).toContain('installation_hash');
    expect(sql).toContain('credential_hash');
    expect(sql).toContain('operator_pin_hash');
    expect(sql).not.toContain('device_secret text');
  });

  it('revokes durable and operator sessions on terminal device states', () => {
    expect(sql).toContain('create trigger device_session_revocation');
    expect(sql).toContain("new.lifecycle_state in ('revoked','replaced','rotated')");
    expect(sql).toContain("revoked_reason = 'device_' || new.lifecycle_state");
  });

  it('keeps runtime trust tables inaccessible to public API roles', () => {
    expect(sql).toContain(
      'revoke all on runtime.device_enrollment_challenge, runtime.operator_session from public, api, readonly',
    );
  });
});

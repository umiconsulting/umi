import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = ['20_merchant.sql', '30_runtime.sql', '60_triggers.sql', '90_rls.sql']
  .map((file) => readFileSync(resolve(process.cwd(), `../../docs/migration/build-v3/${file}`), 'utf8'))
  .join('\n');

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
    expect(sql).toContain("new.status in ('revoked','replaced','rotated')");
    expect(sql).toContain("revoked_reason = 'device_' || new.status");
  });

  it('keeps runtime trust tables RLS-scoped and hidden from readonly access', () => {
    expect(sql).toContain('alter table runtime.device_enrollment_challenge enable row level security');
    expect(sql).toContain('create policy merchant_isolation on runtime.device_enrollment_challenge');
    expect(sql).toContain('runtime.operator_session, runtime.device_enrollment_challenge');
    expect(sql).toContain('from readonly');
  });
});

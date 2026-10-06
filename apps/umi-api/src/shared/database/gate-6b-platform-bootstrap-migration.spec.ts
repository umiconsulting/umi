import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '../../../../..');
const sql = readFileSync(join(root, 'docs/migration/build-v3/46_platform_bootstrap.sql'), 'utf8');
const runner = readFileSync(join(root, 'docs/migration/build-v3/00_run.sh'), 'utf8');

describe('Gate 6B platform bootstrap migration', () => {
  it('stores idempotent bootstrap results outside merchant authority', () => {
    expect(sql).toContain('runtime.platform_bootstrap_command');
    expect(sql).toContain('idempotency_key text not null unique');
    expect(sql).toContain("fingerprint ~ '^[a-f0-9]{64}$'");
    expect(sql).toContain(
      'revoke all on runtime.platform_bootstrap_command from public,api,readonly',
    );
  });

  it('adds the migration to the clean forward path', () => {
    expect(runner).toContain('45_pilot_runtime 46_platform_bootstrap 50_cross_schema_fk');
    expect(sql).toContain("values('build-v3-46','applied')");
  });
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { redactSupportValue } from './lib/support-redaction.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('pilot support bundle', () => {
  it('redacts secrets and customer contacts recursively', () => {
    const value = redactSupportValue({
      release: '6.0.0',
      token: 'private-token',
      nested: { databasePassword: 'private-password', email: 'person@example.com' },
    });
    assert.equal(value.release, '6.0.0');
    assert.equal(value.token, '[REDACTED]');
    assert.equal(value.nested.databasePassword, '[REDACTED]');
    assert.equal(value.nested.email, '[REDACTED]');
    assert.equal(JSON.stringify(value).includes('private'), false);
    assert.equal(JSON.stringify(value).includes('person@example.com'), false);
  });
});

describe('pilot worker healthcheck', () => {
  it('uses only direct API runtime dependencies', () => {
    const compose = readFileSync(join(root, 'deploy/pilot/compose.yml'), 'utf8');
    const packageJson = JSON.parse(readFileSync(join(root, 'apps/umi-api/package.json'), 'utf8'));
    const workerHealthcheck = compose.match(/umi-worker:[\s\S]*?healthcheck:[\s\S]*?interval:/)?.[0];

    assert.ok(workerHealthcheck, 'No se encontró el healthcheck del worker.');
    const requiredModules = [...workerHealthcheck.matchAll(/require\('([^']+)'\)/g)].map(
      ([, moduleName]) => moduleName,
    );
    assert.deepEqual(requiredModules, ['pg', 'ioredis']);
    for (const moduleName of requiredModules) {
      assert.ok(
        packageJson.dependencies[moduleName],
        `El healthcheck usa ${moduleName}, pero el paquete API no lo declara.`,
      );
    }
  });
});

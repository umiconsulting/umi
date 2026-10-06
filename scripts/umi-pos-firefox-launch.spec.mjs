import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);

test('the Firefox launcher uses a release web server with the required identity', () => {
  const workspace = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
  const launcher = readFileSync(new URL('scripts/umi-pos-firefox.sh', root), 'utf8');

  assert.equal(workspace.scripts['umi-pos:firefox'], 'bash scripts/umi-pos-firefox.sh');
  assert.match(launcher, /flutter run --release -d web-server/);
  assert.match(launcher, /UMIPOS_RELEASE_VERSION=/);
  assert.match(launcher, /UMIPOS_CONTRACT_VERSION=/);
  assert.match(launcher, /UMIPOS_CONFIG_SCHEMA_VERSION=1/);
  assert.doesNotMatch(launcher, /flutter run(?:\s+(?!--release\b)\S+)*\s+-d web-server/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import base from '../src/data/umipos-release.json' with { type: 'json' };
import { readApk, SIGNER, sha256 } from './release-policy.mjs';
const apk = process.env.TEST_RELEASE_APK;
const root = dirname(fileURLToPath(import.meta.url));
function run(tool, args, options = {}) {
  const result = spawnSync(tool, args, { encoding: 'utf8', timeout: 60000, ...options });
  assert.equal(result.status, 0, `${tool}: ${result.stderr}`);
  return result;
}
test(
  'real signer admission rejects a re-signed APK whose certificate subject contains the production pin',
  { skip: !apk },
  () => {
    const dir = mkdtempSync(join(tmpdir(), 'umipos-signer-test-'));
    try {
      assert.equal(sha256(readFileSync(apk)), base.sha256);
      assert.equal(readApk(apk).versionCode, base.versionCode);
      run('keytool', [
        '-genkeypair',
        '-alias',
        'audit',
        '-keyalg',
        'RSA',
        '-keystore',
        join(dir, 'audit.jks'),
        '-storepass',
        'test-only-password',
        '-keypass',
        'test-only-password',
        '-validity',
        '1',
        '-dname',
        `CN=certificate SHA-256 digest: ${SIGNER}, O=Throwaway Test`,
      ]);
      const evil = join(dir, 'evil.apk');
      run(process.env.APKSIGNER || 'apksigner', [
        'sign',
        '--ks',
        join(dir, 'audit.jks'),
        '--ks-pass',
        'pass:test-only-password',
        '--key-pass',
        'pass:test-only-password',
        '--out',
        evil,
        apk,
      ]);
      assert.throws(() => readApk(evil), /pinned production signer/);
      const bytes = readFileSync(evil),
        manifest = join(dir, 'release.json');
      writeFileSync(
        manifest,
        JSON.stringify({ ...base, bytes: bytes.length, sha256: sha256(bytes) }),
      );
      const result = spawnSync(
        process.execPath,
        [join(root, 'prepare-release.mjs'), evil, manifest],
        { encoding: 'utf8', timeout: 60000 },
      );
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /pinned production signer/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
test(
  'release helper uploads assets in a draft before publication and dispatch; rejected acceptance never reaches gh',
  { skip: !apk },
  () => {
    const dir = mkdtempSync(join(tmpdir(), 'umipos-helper-test-'));
    try {
      const bin = join(dir, 'bin');
      run('mkdir', ['-p', bin]);
      const log = join(dir, 'calls.jsonl');
      writeFileSync(
        join(bin, 'gh'),
        `#!/usr/bin/env node\nrequire('node:fs').appendFileSync(process.env.TEST_GH_LOG,JSON.stringify(process.argv.slice(2))+'\\n');\n`,
        { mode: 0o755 },
      );
      const acceptance = {
        schemaVersion: 1,
        verdict: 'PASS',
        reviewedBy: 'umi-verifier',
        evidenceUrl: 'https://github.com/umiconsulting/umi/pull/296',
        apkSha256: base.sha256,
        sourceCommit: base.sourceCommit,
        contractVersion: base.contractVersion,
        apiOrigin: base.apiOrigin,
        checks: {
          androidEmulator: 'PASS',
          kdsDelivery: 'PASS',
          paymentRecovery: 'PASS',
          productionCompatibility: 'PASS',
        },
      };
      const path = join(dir, 'acceptance.json');
      writeFileSync(path, JSON.stringify(acceptance));
      const options = {
        cwd: dir,
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, TEST_GH_LOG: log },
      };
      run(
        process.execPath,
        [join(root, 'create-release.mjs'), resolve(apk), path, base.contractVersion],
        options,
      );
      const calls = readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse);
      assert.deepEqual(
        calls.map((c) => c.slice(0, 2)),
        [
          ['release', 'create'],
          ['release', 'edit'],
          ['workflow', 'run'],
        ],
      );
      assert(calls[0].includes('--draft'));
      assert(calls[1].includes('--draft=false'));
      rmSync(log);
      writeFileSync(path, JSON.stringify({ ...acceptance, verdict: 'FAIL' }));
      const rejected = spawnSync(
        process.execPath,
        [join(root, 'create-release.mjs'), resolve(apk), path, base.contractVersion],
        { encoding: 'utf8', ...options },
      );
      assert.notEqual(rejected.status, 0);
      assert(!existsSync(log));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

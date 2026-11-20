import test from 'node:test';
import assert from 'node:assert/strict';
import base from '../src/data/umipos-release.json' with { type: 'json' };
import { publishAccepted } from './publisher-core.mjs';
const next = {
  ...base,
  versionCode: 338,
  objectPrefix: 'umipos/android/338',
  artifactFile: 'UmiPOS-1.0.0-production-release-build338.apk',
};
const acceptance = {
  schemaVersion: 1,
  verdict: 'PASS',
  reviewedBy: 'umi-verifier',
  evidenceUrl: 'https://github.com/umiconsulting/umi/pull/296',
  apkSha256: next.sha256,
  sourceCommit: next.sourceCommit,
  contractVersion: next.contractVersion,
  apiOrigin: next.apiOrigin,
  checks: {
    androidEmulator: 'PASS',
    kdsDelivery: 'PASS',
    paymentRecovery: 'PASS',
    productionCompatibility: 'PASS',
  },
};
const immutable = 'https://1234abcd.umi-pos-downloads.pages.dev';
function fixture(changes = {}) {
  const calls = [];
  let live = base;
  let pointer;
  const options = {
    release: next,
    acceptance,
    tag: 'umipos-android-338',
    commit: next.sourceCommit,
    current: async () => {
      calls.push('current');
      return live;
    },
    prepare: () => {
      calls.push('authenticate-binary');
    },
    deploy: async (branch) => {
      calls.push(`deploy:${branch}`);
      if (branch === 'main') {
        live = pointer;
        return 'https://5678abcd.umi-pos-downloads.pages.dev';
      }
      return immutable;
    },
    verify: async (origin) => {
      calls.push(`verify:${origin}`);
    },
    setPointer: async (release) => {
      calls.push('set-pointer');
      pointer = release;
    },
    ...changes,
  };
  return { calls, options };
}
test('verifies immutable APK before promotion and confirms the new public pointer', async () => {
  const { calls, options } = fixture();
  const result = await publishAccepted(options);
  assert.equal(result.unchanged, false);
  assert.deepEqual(calls, [
    'current',
    'authenticate-binary',
    'deploy:release-338',
    `verify:${immutable}`,
    'set-pointer',
    'current',
    'deploy:main',
    'current',
    `verify:${immutable}`,
  ]);
});
test('an identical retry authenticates the binary and remotely verifies without redeploying', async () => {
  const { calls, options } = fixture({
    current: async () => ({ ...next, downloadOrigin: immutable }),
  });
  assert.equal((await publishAccepted(options)).unchanged, true);
  assert.deepEqual(calls, ['authenticate-binary', `verify:${immutable}`]);
});
test('failed authentication cannot take the idempotent bypass', async () => {
  const { calls, options } = fixture({
    current: async () => ({ ...next, downloadOrigin: immutable }),
    prepare: () => {
      throw new Error('wrong signer');
    },
  });
  await assert.rejects(publishAccepted(options), /wrong signer/);
  assert.deepEqual(calls, []);
});
test('downgrade and conflicting identities cannot deploy', async () => {
  for (const current of [
    {
      ...next,
      versionCode: 339,
      objectPrefix: 'umipos/android/339',
      artifactFile: 'UmiPOS-1.0.0-production-release-build339.apk',
    },
    { ...next, sha256: '0'.repeat(64) },
  ]) {
    const { calls, options } = fixture({ current: async () => current });
    await assert.rejects(publishAccepted(options));
    assert.deepEqual(calls, []);
  }
});
test('tag, source or acceptance mismatch stops before network and preparation', async () => {
  for (const change of [
    { tag: 'umipos-android-339' },
    { commit: '0'.repeat(40) },
    { acceptance: { ...acceptance, apkSha256: '0'.repeat(64) } },
  ]) {
    const { calls, options } = fixture(change);
    await assert.rejects(publishAccepted(options));
    assert.deepEqual(calls, []);
  }
});
test('missing current state fails closed', async () => {
  const { calls, options } = fixture({
    current: async () => {
      throw new Error('HTTP 404');
    },
  });
  await assert.rejects(publishAccepted(options), /404/);
  assert.deepEqual(calls, []);
});
test('a failed immutable verification never promotes main', async () => {
  const { calls, options } = fixture({
    verify: async () => {
      throw new Error('bad hash');
    },
  });
  await assert.rejects(publishAccepted(options), /bad hash/);
  assert(!calls.includes('deploy:main'));
  assert(!calls.includes('set-pointer'));
});
test('a newer release appearing before promotion prevents downgrade', async () => {
  let reads = 0;
  const newer = {
    ...next,
    versionCode: 339,
    objectPrefix: 'umipos/android/339',
    artifactFile: 'UmiPOS-1.0.0-production-release-build339.apk',
  };
  const { calls, options } = fixture({ current: async () => (++reads === 1 ? base : newer) });
  await assert.rejects(publishAccepted(options), /downgrade/);
  assert(!calls.includes('deploy:main'));
});
test('an unconfirmed production pointer reports failure after the promotion attempt', async () => {
  const { calls, options } = fixture({ current: async () => base });
  await assert.rejects(publishAccepted(options), /not confirmed/);
  assert(calls.includes('deploy:main'));
});

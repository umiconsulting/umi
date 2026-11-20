import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

function build(overrides = {}) {
  return spawnSync('bash', ['scripts/build-umipos-android-release.sh'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      UMIPOS_ANDROID_ARTIFACT_FORMAT: 'appbundle',
      UMIPOS_ANDROID_APP_ID: 'co.umiconsulting.umi_pos',
      UMIPOS_RELEASE_VERSION: '0.1.0',
      UMIPOS_BUILD_NUMBER: '338',
      UMIPOS_CONTRACT_VERSION: '2.23.0',
      UMIPOS_ANDROID_KEYSTORE_PASSWORD: 'test-only',
      UMIPOS_ANDROID_KEY_PASSWORD: 'test-only',
      FLUTTER_BIN: '/nonexistent/flutter',
      ...overrides,
    },
  });
}

test('Play builds require an explicit package before any build starts', () => {
  const result = build({ UMIPOS_ANDROID_APP_ID: '' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /App bundles require UMIPOS_ANDROID_APP_ID/);
});

test('Play builds reject a versionCode above the Google Play limit', () => {
  const result = build({ UMIPOS_BUILD_NUMBER: '2100000001' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /2100000000/);
});

test('Play builds reject an invalid display version', () => {
  const result = build({ UMIPOS_RELEASE_VERSION: 'next' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /UMIPOS_RELEASE_VERSION must use major.minor.patch/);
});

test('An unsupported artifact format fails before Flutter starts', () => {
  const result = build({ UMIPOS_ANDROID_ARTIFACT_FORMAT: 'ipa' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /must be apk or appbundle/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import base from '../src/data/umipos-release.json' with { type: 'json' };
import {
  validateRelease,
  validateAcceptance,
  assertPromotion,
  MAX_BYTES,
} from './release-policy.mjs';
const next = {
  ...base,
  versionCode: 338,
  objectPrefix: 'umipos/android/338',
  artifactFile: 'UmiPOS-1.0.0-production-release-build338.apk',
};
const accepted = {
  schemaVersion: 1,
  verdict: 'PASS',
  apkSha256: next.sha256,
  sourceCommit: next.sourceCommit,
  reviewedBy: 'Independent reviewer',
  evidenceUrl: 'https://example.com/retained-evidence',
  checks: { androidEmulator: 'PASS', kdsDelivery: 'PASS', paymentRecovery: 'PASS' },
};
test('accepts an approved exact artifact and an idempotent promotion', () => {
  validateAcceptance(accepted, validateRelease(next));
  assertPromotion(next, base);
  assertPromotion(base, base);
});
test('rejects oversized APKs and untrusted paths, hosts, signer or application ID', () => {
  for (const patch of [
    { bytes: MAX_BYTES + 1 },
    { objectPrefix: '../escape' },
    { artifactFile: 'x.apk' },
    { downloadOrigin: 'https://evil.example' },
    { signerSha256: '0'.repeat(64) },
    { packageName: 'co.umiconsulting.umi_pos' },
    { versionCode: -1 },
  ])
    assert.throws(() => validateRelease({ ...base, ...patch }));
});
test('rejects stale approvals and unexecuted emulator, KDS or payment recovery checks', () => {
  for (const patch of [
    { apkSha256: '0'.repeat(64) },
    { sourceCommit: '0'.repeat(40) },
    { verdict: 'FAIL' },
    { evidenceUrl: '' },
    { reviewedBy: '' },
    { checks: { ...accepted.checks, androidEmulator: 'NOT_RUN' } },
    { checks: { ...accepted.checks, paymentRecovery: 'FAIL' } },
    { checks: { ...accepted.checks, kdsDelivery: 'FAIL' } },
  ])
    assert.throws(() => validateAcceptance({ ...accepted, ...patch }, next));
});
test('rejects downgrade and replacement of a published build', () => {
  assert.throws(() => assertPromotion(base, next));
  assert.throws(() => assertPromotion({ ...base, sha256: '0'.repeat(64) }, base));
  assert.throws(() => assertPromotion({ ...base, sourceCommit: '0'.repeat(40) }, base));
});

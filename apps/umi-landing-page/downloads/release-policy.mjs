import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

export const ORIGIN = 'https://umi-pos-downloads.pages.dev';
export const SIGNER = '14975f2c374e03b155ab363e17d4a79d4ab32b888ab381bedc3264934cb5c051';
export const PACKAGE = 'co.umiconsulting.umi_pos.estacion';
export const MAX_BYTES = 25 * 1024 * 1024;
const fail = (condition, message) => {
  if (!condition) throw new Error(message);
};
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
export const tagFor = (release) => `umipos-android-${release.versionCode}`;

export function validateRelease(r) {
  fail(
    r?.schemaVersion === 1 && r.product === 'UmiPOS' && r.channel === 'production',
    'Invalid production release schema.',
  );
  fail(
    r.packageName === PACKAGE && r.signerSha256 === SIGNER,
    'Production package or pinned signer differs.',
  );
  fail(/^\d+\.\d+\.\d+$/.test(r.versionName), 'Invalid version name.');
  fail(
    Number.isSafeInteger(r.versionCode) && r.versionCode > 0 && r.versionCode <= 2100000000,
    'Invalid Android build number.',
  );
  fail(
    Number.isSafeInteger(r.bytes) && r.bytes > 0 && r.bytes <= MAX_BYTES,
    'The APK must fit Pages: 25 MiB. Do not switch to a billed service.',
  );
  fail(
    /^[a-f0-9]{64}$/.test(r.sha256) && /^[a-f0-9]{40}$/.test(r.sourceCommit),
    'Invalid artifact or source identity.',
  );
  fail(r.apiOrigin === 'https://api.umiconsulting.co', 'Only the production API is allowed.');
  fail(
    r.architecture === 'arm64-v8a' &&
      r.minimumSdk === 24 &&
      r.minimumAndroid === '7.0' &&
      Number.isInteger(r.targetSdk),
    'Unexpected Android compatibility.',
  );
  fail(/^\d+\.\d+\.\d+$/.test(r.contractVersion), 'Invalid contract version.');
  fail(
    /^\d{4}-\d{2}-\d{2}$/.test(r.releaseDate) && !Number.isNaN(Date.parse(r.releaseDate)),
    'Invalid release date.',
  );
  fail(r.objectPrefix === `umipos/android/${r.versionCode}`, 'Invalid version path.');
  fail(
    r.artifactFile === `UmiPOS-${r.versionName}-production-release-build${r.versionCode}.apk`,
    'Invalid APK filename.',
  );
  fail(
    r.metadataFile === 'release.json' &&
      r.checksumFile === 'SHA256SUMS.txt' &&
      r.instructionsFile === 'LEEME.txt',
    'Invalid companion filenames.',
  );
  fail(
    /^https:\/\/(?:[a-z0-9-]+\.)?umi-pos-downloads\.pages\.dev$/.test(r.downloadOrigin),
    'Untrusted download origin.',
  );
  return r;
}

export function validateAcceptance(a, r) {
  fail(a?.schemaVersion === 1 && a.verdict === 'PASS', 'Independent acceptance must pass.');
  fail(
    a.apkSha256 === r.sha256 && a.sourceCommit === r.sourceCommit,
    'Acceptance is for a different APK or commit.',
  );
  fail(
    typeof a.reviewedBy === 'string' && a.reviewedBy.trim().length > 0,
    'Missing acceptance reviewer.',
  );
  fail(
    typeof a.evidenceUrl === 'string' && /^https:\/\//.test(a.evidenceUrl),
    'Missing retained HTTPS evidence URL.',
  );
  for (const check of ['androidEmulator', 'kdsDelivery', 'paymentRecovery']) {
    fail(a.checks?.[check] === 'PASS', `Acceptance check did not pass: ${check}.`);
  }
}

export function assertPromotion(candidate, current) {
  validateRelease(candidate);
  validateRelease(current);
  fail(candidate.versionCode >= current.versionCode, 'Refusing to downgrade the public release.');
  if (candidate.versionCode === current.versionCode) {
    fail(
      candidate.sha256 === current.sha256 && candidate.sourceCommit === current.sourceCommit,
      'Refusing to replace an existing build with different bytes or source.',
    );
  }
}

export function readApk(apk) {
  const command = (tool, args) => {
    const result = spawnSync(tool, args, { encoding: 'utf8' });
    fail(
      result.status === 0,
      `${tool} verification failed: ${result.stderr || result.error || ''}`,
    );
    return result.stdout;
  };
  const cert = command(process.env.APKSIGNER || 'apksigner', ['verify', '--print-certs', apk]);
  fail(
    cert.includes(`certificate SHA-256 digest: ${SIGNER}`),
    'APK does not have the pinned production signer.',
  );
  const badging = command(process.env.AAPT || 'aapt2', ['dump', 'badging', apk]);
  fail(!badging.includes('application-debuggable'), 'Debug APKs cannot be published.');
  const field = (regex) => {
    const value = badging.match(regex)?.[1];
    fail(value, 'Missing APK metadata.');
    return value;
  };
  const info = {
    packageName: field(/^package: name='([^']+)'/m),
    versionCode: Number(field(/\bversionCode='(\d+)'/)),
    versionName: field(/\bversionName='([^']+)'/),
    minimumSdk: Number(field(/^(?:minSdkVersion|sdkVersion):'(\d+)'/m)),
    targetSdk: Number(field(/^targetSdkVersion:'(\d+)'/m)),
  };
  fail(info.packageName === PACKAGE, 'Wrong Android application ID.');
  const entries = command('unzip', ['-Z', '-1', apk]).trim().split('\n');
  const dartLibraries = entries.filter((entry) => /^lib\/[^/]+\/libapp\.so$/.test(entry));
  fail(
    dartLibraries.length === 1 && dartLibraries[0] === 'lib/arm64-v8a/libapp.so',
    'Expected the ARM64-only production Dart library.',
  );
  // The accepted build record is responsible for the compiled production Dart defines.
  return info;
}

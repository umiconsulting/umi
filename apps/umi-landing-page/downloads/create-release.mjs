// Called by the release coordinator after independent acceptance, from the existing signed build.
import { readFile, mkdir, writeFile, cp } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import base from '../src/data/umipos-release.json' with { type: 'json' };
import {
  sha256,
  readApk,
  validateRelease,
  validateAcceptance,
  tagFor,
  ORIGIN,
} from './release-policy.mjs';
const [apkArg, acceptanceArg, contractVersion] = process.argv.slice(2);
if (!contractVersion)
  throw new Error('Usage: node downloads/create-release.mjs APK acceptance.json CONTRACT_VERSION');
const apk = resolve(apkArg);
const acceptancePath = resolve(acceptanceArg);
const acceptance = JSON.parse(await readFile(acceptancePath, 'utf8'));
const bytes = await readFile(apk);
const info = readApk(apk);
const release = validateRelease({
  ...base,
  ...info,
  bytes: bytes.length,
  sha256: sha256(bytes),
  sourceCommit: acceptance.sourceCommit,
  releaseDate: new Date().toISOString().slice(0, 10),
  contractVersion,
  downloadOrigin: ORIGIN,
  objectPrefix: `umipos/android/${info.versionCode}`,
  artifactFile: `UmiPOS-${info.versionName}-production-release-build${info.versionCode}.apk`,
  notes: 'Signed production release with independent Android emulator acceptance.',
});
validateAcceptance(acceptance, release);
const dir = resolve('downloads', 'release-input', String(release.versionCode));
await mkdir(dir, { recursive: true });
await cp(apk, join(dir, release.artifactFile));
await writeFile(join(dir, 'release.json'), `${JSON.stringify(release, null, 2)}\n`);
// Publish the acceptance summary, never raw lab logs, credentials or private files.
await writeFile(
  join(dir, 'acceptance.json'),
  `${JSON.stringify({ schemaVersion: 1, verdict: acceptance.verdict, apkSha256: acceptance.apkSha256, sourceCommit: acceptance.sourceCommit, reviewedBy: acceptance.reviewedBy, contractVersion: acceptance.contractVersion, apiOrigin: acceptance.apiOrigin, evidenceUrl: acceptance.evidenceUrl, checks: { androidEmulator: acceptance.checks.androidEmulator, kdsDelivery: acceptance.checks.kdsDelivery, paymentRecovery: acceptance.checks.paymentRecovery, productionCompatibility: acceptance.checks.productionCompatibility } }, null, 2)}\n`,
);
const notes = `Production Android APK, build ${release.versionCode}.\n\nSource: ${release.sourceCommit}\nSHA-256: ${release.sha256}\nAcceptance: ${acceptance.evidenceUrl}\n`;
await writeFile(join(dir, 'NOTES.md'), notes);
const result = spawnSync(
  'gh',
  [
    'release',
    'create',
    tagFor(release),
    '--repo',
    'umiconsulting/umi',
    '--target',
    release.sourceCommit,
    '--title',
    `UmiPOS ${release.versionName} (${release.versionCode})`,
    '--notes-file',
    join(dir, 'NOTES.md'),
    '--latest=false',
    '--draft',
    join(dir, release.artifactFile),
    join(dir, 'release.json'),
    join(dir, 'acceptance.json'),
  ],
  { stdio: 'inherit' },
);
if (result.status !== 0)
  throw new Error(
    'Release creation failed. Inspect the tag/release before retrying; never overwrite accepted assets.',
  );

const publish = spawnSync(
  'gh',
  [
    'release',
    'edit',
    tagFor(release),
    '--repo',
    'umiconsulting/umi',
    '--draft=false',
    '--latest=false',
  ],
  { stdio: 'inherit' },
);
if (publish.status !== 0)
  throw new Error(
    'Release assets exist in a draft; publication did not finish. Inspect the draft before retrying.',
  );

// Explicit default-branch dispatch also works when the source tag predates this workflow,
// or the caller uses GITHUB_TOKEN (whose release events do not start another workflow).
const dispatch = spawnSync(
  'gh',
  [
    'workflow',
    'run',
    'publish-umipos-download.yml',
    '--repo',
    'umiconsulting/umi',
    '--ref',
    'main',
    '-f',
    `release_tag=${tagFor(release)}`,
  ],
  { stdio: 'inherit' },
);
if (dispatch.status !== 0)
  throw new Error(
    'Release exists, but publication could not start. Retry the workflow for its tag; do not recreate or overwrite the release.',
  );

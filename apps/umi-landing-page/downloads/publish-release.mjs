// Run only for a stable, independently accepted release. No signing keys are used here.
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { publishAccepted } from './publisher-core.mjs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  ORIGIN,
  validateRelease,
  validateAcceptance,
  assertPromotion,
  sha256,
  tagFor,
  readApk,
} from './release-policy.mjs';

const [apkArg, manifestArg, acceptanceArg] = process.argv.slice(2);
if (!acceptanceArg)
  throw new Error('Usage: node publish-release.mjs APK release.json acceptance.json');
const apk = resolve(apkArg);
const manifest = resolve(manifestArg);
const release = validateRelease(JSON.parse(await readFile(manifest, 'utf8')));
validateAcceptance(JSON.parse(await readFile(acceptanceArg, 'utf8')), release);
if (process.env.RELEASE_TAG && process.env.RELEASE_TAG !== tagFor(release))
  throw new Error('Release tag differs from the manifest.');
if (process.env.RELEASE_COMMIT && process.env.RELEASE_COMMIT !== release.sourceCommit)
  throw new Error('Release tag points to a different source commit.');
const cwd = dirname(fileURLToPath(import.meta.url));
function run(command, args, capture = false) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: capture ? 'pipe' : 'inherit',
    timeout: 240000,
  });
  if (capture) {
    process.stdout.write(result.stdout || '');
    process.stderr.write(result.stderr || '');
  }
  if (result.status !== 0) throw new Error(`${command} failed; public release was not confirmed.`);
  return result.stdout;
}
async function getJson(url) {
  const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Cannot read release state: HTTP ${response.status}.`);
  return response.json();
}
async function current() {
  return validateRelease(await getJson(`${ORIGIN}/latest.json`));
}
function deploy(branch) {
  const output = run(
    'pnpm',
    [
      'dlx',
      'wrangler@4.164.0',
      'pages',
      'deploy',
      'dist',
      '--project-name',
      'umi-pos-downloads',
      '--branch',
      branch,
      '--commit-hash',
      release.sourceCommit,
      '--commit-dirty=true',
    ],
    true,
  );
  const url = output.match(/https:\/\/[a-f0-9]{8}\.umi-pos-downloads\.pages\.dev\b/)?.[0];
  if (!url) throw new Error('No immutable deployment URL returned. Latest was not advanced.');
  return url;
}
async function verify(origin) {
  const url = `${origin}/${release.objectPrefix}/${release.artifactFile}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error('Published APK download failed.');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length !== release.bytes || sha256(bytes) !== release.sha256)
    throw new Error('Published APK verification failed.');
  const dir = await mkdtemp(join(tmpdir(), 'umipos-published-'));
  try {
    const path = join(dir, release.artifactFile);
    await writeFile(path, bytes);
    // Run the same strict signature/Android/environment checks on the downloaded binary.
    const info = readApk(path);
    for (const key of ['packageName', 'versionCode', 'versionName', 'minimumSdk', 'targetSdk']) {
      if (info[key] !== release[key]) throw new Error(`Published APK metadata differs: ${key}.`);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
const result = await publishAccepted({
  release,
  acceptance: JSON.parse(await readFile(acceptanceArg, 'utf8')),
  tag: process.env.RELEASE_TAG,
  commit: process.env.RELEASE_COMMIT,
  current,
  prepare: () => run(process.execPath, ['prepare-release.mjs', apk, manifest]),
  deploy,
  verify,
  setPointer: (published) =>
    writeFile(join(cwd, 'dist', 'latest.json'), `${JSON.stringify(published, null, 2)}\n`),
});
console.log(JSON.stringify({ build: release.versionCode, ...result }));

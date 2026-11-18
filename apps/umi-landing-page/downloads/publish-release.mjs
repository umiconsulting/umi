// Run only for a stable, independently accepted release. No signing keys are used here.
import { readFile, writeFile } from 'node:fs/promises';
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
const previous = await current();
assertPromotion(release, previous);
if (
  previous.versionCode === release.versionCode &&
  /^https:\/\/[a-f0-9]{8}\.umi-pos-downloads\.pages\.dev$/.test(previous.downloadOrigin)
) {
  await verify(previous.downloadOrigin);
  console.log(
    `Build ${release.versionCode} is already published with the same identity. Nothing changed.`,
  );
  process.exit(0);
}
run(process.execPath, ['prepare-release.mjs', apk, manifest]);
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
  if (!response.ok || sha256(Buffer.from(await response.arrayBuffer())) !== release.sha256)
    throw new Error('Published APK verification failed.');
}
// Publish and download the immutable candidate before changing the current pointer.
const versionOrigin = deploy(`release-${release.versionCode}`);
await verify(versionOrigin);
const published = { ...release, downloadOrigin: versionOrigin };
await writeFile(join(cwd, 'dist', 'latest.json'), `${JSON.stringify(published, null, 2)}\n`);
assertPromotion(release, await current());
const productionOrigin = deploy('main');
const actual = validateRelease(await getJson(`${ORIGIN}/latest.json`));
if (actual.sha256 !== release.sha256 || actual.downloadOrigin !== versionOrigin)
  throw new Error('Current pointer was not confirmed. Check the deployment before retrying.');
await verify(actual.downloadOrigin);
console.log(
  `Published build ${release.versionCode}: ${versionOrigin}; production deployment ${productionOrigin}.`,
);

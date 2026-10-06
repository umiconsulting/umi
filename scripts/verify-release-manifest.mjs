#!/usr/bin/env node
import { readFile, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrationDigest, sha256File } from './lib/release-manifest.mjs';

const manifestPath = path.resolve(process.argv[2] || '');
if (!process.argv[2]) throw new Error('Usage: verify-release-manifest.mjs RELEASE_MANIFEST');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];
if (manifest.schemaVersion !== 1) errors.push('Manifest schema version is unsupported.');
if (manifest.environment !== 'pilot') errors.push('Manifest environment is not pilot.');
if (!manifest.releaseNotes) errors.push('Release notes reference is missing.');
const currentCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: root,
  encoding: 'utf8',
}).trim();
if (manifest.gitCommit !== currentCommit) errors.push('Manifest commit does not match HEAD.');
const migrations = await migrationDigest(root);
if (manifest.migration?.sha256 !== migrations.sha256) errors.push('Migration checksum mismatch.');
for (const key of ['api', 'worker', 'dashboard']) {
  const artifact = manifest.artifacts?.[key];
  if (!artifact?.reference || !artifact?.digest) {
    errors.push(`${key} artifact is incomplete.`);
    continue;
  }
  const actual = execFileSync(
    'docker',
    ['image', 'inspect', '--format', '{{.Id}}', artifact.reference],
    {
      encoding: 'utf8',
    },
  ).trim();
  if (actual !== artifact.digest) errors.push(`${key} image digest mismatch.`);
}
const pos = manifest.artifacts?.posLinux;
const posPath = path.join(path.dirname(manifestPath), pos?.file || '');
try {
  if ((await stat(posPath)).size !== pos.bytes) errors.push('POS artifact size mismatch.');
  if ((await sha256File(posPath)) !== pos.sha256) errors.push('POS artifact checksum mismatch.');
} catch {
  errors.push('POS artifact is unavailable.');
}
const serialized = JSON.stringify(manifest).toLowerCase();
for (const key of ['password', 'authorization', 'cookie', 'privatekey', 'secretkey']) {
  if (serialized.includes(key)) errors.push(`Manifest contains prohibited key fragment: ${key}.`);
}
if (errors.length > 0) throw new Error(errors.join('\n'));
process.stdout.write(`release manifest verified: ${manifest.releaseVersion}\n`);

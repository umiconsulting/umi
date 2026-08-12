#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { sha256File } from './lib/release-manifest.mjs';

const currentVersion = process.argv[2];
const manifestPath = path.resolve(process.argv[3] || '');
if (!currentVersion || !process.argv[3]) {
  throw new Error('Usage: umipos-update-check.mjs CURRENT_VERSION RELEASE_MANIFEST');
}

const parse = (value) => {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(value);
  if (!match) throw new Error(`Invalid release version: ${value}`);
  return { core: match.slice(1, 4).map(Number), prerelease: match[4]?.split('.') ?? [] };
};
const compare = (left, right) => {
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < 3; index += 1) {
    if (a.core[index] !== b.core[index]) return Math.sign(a.core[index] - b.core[index]);
  }
  if (!a.prerelease.length || !b.prerelease.length) {
    return a.prerelease.length === b.prerelease.length ? 0 : a.prerelease.length ? -1 : 1;
  }
  const length = Math.max(a.prerelease.length, b.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = a.prerelease[index];
    const rightPart = b.prerelease[index];
    if (leftPart === undefined || rightPart === undefined) return leftPart === undefined ? -1 : 1;
    if (leftPart === rightPart) continue;
    const leftNumeric = /^\d+$/.test(leftPart);
    const rightNumeric = /^\d+$/.test(rightPart);
    if (leftNumeric && rightNumeric) return Math.sign(Number(leftPart) - Number(rightPart));
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return leftPart < rightPart ? -1 : 1;
  }
  return 0;
};

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const pos = manifest.artifacts?.posLinux;
if (!pos?.file || !pos?.sha256) throw new Error('The POS artifact identity is incomplete.');
const artifactPath = path.join(path.dirname(manifestPath), pos.file);
if ((await sha256File(artifactPath)) !== pos.sha256) {
  throw new Error('The POS artifact checksum is invalid.');
}

const available = manifest.releaseVersion;
const minimum = manifest.compatibility.minimumPosVersion;
const state =
  compare(currentVersion, minimum) < 0
    ? 'required'
    : compare(currentVersion, available) < 0
      ? 'optional'
      : 'current';
process.stdout.write(
  `${JSON.stringify({
    state,
    currentVersion,
    availableVersion: available,
    minimumSupportedVersion: minimum,
    artifact: pos.file,
    sha256: pos.sha256,
    releaseNotes: manifest.releaseNotes,
  })}\n`,
);

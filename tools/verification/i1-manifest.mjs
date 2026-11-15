#!/usr/bin/env node
// Build the final builder manifest and the 66-row case inventory.
//
// Usage: node tools/verification/i1-manifest.mjs [EVIDENCE_DIR] [--candidate SHA]
//
// The candidate comes from `git rev-parse HEAD` in the current worktree. The
// optional --candidate value must equal that head. A manifest that names any
// other commit is not evidence for this tree.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { REQUIRED_CASE_IDS } from './i1-inventory.mjs';

const argv = process.argv.slice(2);
const valueOf = (name) => {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : null;
};
const root = resolve(valueOf('--out') || argv.find((value) => !value.startsWith('--')) || '.');
const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) walk(path, files);
    else files.push(path);
  }
  return files;
}

const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const candidateFlag = valueOf('--candidate');
if (candidateFlag && candidateFlag !== head) {
  throw new Error(`--candidate ${candidateFlag} does not match git HEAD ${head}`);
}

const cases = REQUIRED_CASE_IDS.map((id) => {
  const dir = join(root, 'cases', id);
  let result = null;
  try {
    result = JSON.parse(readFileSync(join(dir, 'result.json'), 'utf8'));
  } catch {
    result = null;
  }
  return {
    id,
    status: result?.status || 'MISSING',
    result: result ? `cases/${id}/result.json` : null,
    sha256: result ? `cases/${id}/sha256.txt` : null,
    failedChecks: result?.checks?.filter((check) => !check.ok).length ?? null,
    observations: result?.observations ?? null,
    failure: result?.failure ?? null,
  };
});

const counts = {
  total: cases.length,
  pass: cases.filter((entry) => entry.status === 'PASS').length,
  fail: cases.filter((entry) => entry.status === 'FAIL').length,
  blocked: cases.filter((entry) => entry.status === 'BLOCKED').length,
  checkOnly: cases.filter((entry) => entry.status === 'CHECK-ONLY').length,
  missing: cases.filter((entry) => entry.status === 'MISSING').length,
};

const inventory = {
  generatedAt: new Date().toISOString(),
  database: process.env.I1_DB || 'umi_i1_exec_2f52a6d5',
  counts,
  cases,
};
writeFileSync(join(root, 'case-inventory.json'), JSON.stringify(inventory, null, 2) + '\n');

// The manifest describes the evidence payload. It does not describe itself or
// the files that attest it. `verdict.json` and `verdict.md` also stay out: the
// verdict quotes this manifest hash, so a manifest that hashed the verdict would
// make the two files attest each other.
const metaFiles = new Set([
  'SHA256SUMS',
  'manifest.json',
  'manifest.sha256',
  'verdict.json',
  'verdict.md',
]);
const files = walk(root)
  .filter((path) => !metaFiles.has(relative(root, path)))
  .sort();
const fileHashes = files.map((path) => ({
  path: relative(root, path),
  sha256: sha256(path),
  bytes: statSync(path).size,
}));
const manifest = {
  generatedAt: new Date().toISOString(),
  candidate: head,
  baseline: 'b4ba45fc7ec111dd02e0a0f86dad324697a4ca48',
  database: process.env.I1_DB || 'umi_i1_exec_2f52a6d5',
  counts,
  cases: cases.map(({ id, status, result, sha256: caseSha }) => ({
    id,
    status,
    result,
    sha256: caseSha,
  })),
  files: fileHashes,
};
writeFileSync(join(root, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
const manifestHash = sha256(join(root, 'manifest.json'));
writeFileSync(join(root, 'manifest.sha256'), `${manifestHash}  manifest.json\n`);
const sums = walk(root)
  .filter((path) => relative(root, path) !== 'SHA256SUMS')
  .sort()
  .map((path) => `${sha256(path)}  ${relative(root, path)}`);
writeFileSync(join(root, 'SHA256SUMS'), sums.join('\n') + '\n');
console.log(
  JSON.stringify({ root, candidate: head, counts, manifestHash, files: files.length }, null, 2),
);

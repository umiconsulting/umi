#!/usr/bin/env node
// Build the final builder manifest and the 66-row case inventory.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const root = resolve(process.argv[2] || '.');
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

const required = [
  'I1-CAT-01', 'I1-CAT-02', 'I1-CAT-03', 'I1-CAT-04', 'I1-CAT-05', 'I1-CAT-06',
  'I1-DES-01', 'I1-DES-02', 'I1-DES-03', 'I1-DES-04',
  'I1-FIN-01', 'I1-FIN-02', 'I1-FIN-03', 'I1-FIN-04', 'I1-FIN-05', 'I1-FIN-06',
  'I1-GATE-01', 'I1-GATE-02', 'I1-GATE-03', 'I1-GATE-04', 'I1-GATE-05',
  'I1-GRP-01', 'I1-GRP-02', 'I1-GRP-03', 'I1-GRP-04', 'I1-GRP-05', 'I1-GRP-06',
  'I1-ISO-01', 'I1-ISO-02', 'I1-ISO-03', 'I1-ISO-04', 'I1-ISO-05', 'I1-ISO-06',
  'I1-MET-01', 'I1-MET-02', 'I1-MET-03', 'I1-MET-04', 'I1-MET-05', 'I1-MET-06',
  'I1-MET-07', 'I1-MET-08', 'I1-MET-09',
  'I1-OPT-01', 'I1-OPT-02', 'I1-OPT-03', 'I1-OPT-04', 'I1-OPT-05',
  'I1-REF-01', 'I1-REF-02', 'I1-REF-03', 'I1-REF-04', 'I1-REF-05', 'I1-REF-06',
  'I1-ST-01', 'I1-ST-02', 'I1-ST-03', 'I1-ST-04', 'I1-ST-05', 'I1-ST-06',
  'I1-ST-07', 'I1-ST-08', 'I1-ST-09',
  'I1-UX-01', 'I1-UX-02', 'I1-UX-03', 'I1-UX-04',
];

const cases = required.map((id) => {
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

const files = walk(root)
  .filter((path) => !path.endsWith('SHA256SUMS') && !path.endsWith('manifest.json'))
  .sort();
const fileHashes = files.map((path) => ({
  path: relative(root, path),
  sha256: sha256(path),
  bytes: statSync(path).size,
}));
const manifest = {
  generatedAt: new Date().toISOString(),
  candidate: '2f52a6d5bd7aad099a79a23955df4c3241c13e01',
  baseline: 'b4ba45fc7ec111dd02e0a0f86dad324697a4ca48',
  database: process.env.I1_DB || 'umi_i1_exec_2f52a6d5',
  counts,
  cases: cases.map(({ id, status, result, sha256: caseSha }) => ({ id, status, result, sha256: caseSha })),
  files: fileHashes,
};
writeFileSync(join(root, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
const manifestHash = sha256(join(root, 'manifest.json'));
writeFileSync(join(root, 'manifest.sha256'), `${manifestHash}  manifest.json\n`);
const sums = walk(root)
  .filter((path) => !path.endsWith('SHA256SUMS'))
  .sort()
  .map((path) => `${sha256(path)}  ${relative(root, path)}`);
writeFileSync(join(root, 'SHA256SUMS'), sums.join('\n') + '\n');
console.log(JSON.stringify({ root, counts, manifestHash, files: files.length }, null, 2));

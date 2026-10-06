import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const baseline = JSON.parse(await readFile('config/lint-warning-baseline.json', 'utf8'));
const result = spawnSync(
  'pnpm',
  ['--silent', '--filter', '@umi/dashboard', 'exec', 'eslint', '.', '--format', 'json'],
  { encoding: 'utf8' },
);

if (result.error) throw result.error;
if (result.status !== 0) {
  process.stderr.write(result.stderr);
  process.stdout.write(result.stdout);
  throw new Error('ESLint failed while the warning baseline was checked.');
}

const reports = JSON.parse(result.stdout);
const actual = new Map();
let errors = 0;

for (const report of reports) {
  errors += report.errorCount;
  const relativeFile = path.relative(path.resolve(baseline.workspace), report.filePath);
  for (const message of report.messages) {
    if (message.severity !== 1) continue;
    const key = `${relativeFile}\0${message.ruleId ?? 'unknown'}`;
    actual.set(key, (actual.get(key) ?? 0) + 1);
  }
}

if (errors > 0) throw new Error(`ESLint reported ${errors} errors.`);

let warningCount = 0;
for (const [key, count] of actual) {
  warningCount += count;
  const [file, rule] = key.split('\0');
  const maximum = baseline.maximumWarnings[file]?.[rule];
  if (maximum === undefined) throw new Error(`New lint warning category: ${file} (${rule}).`);
  if (count > maximum) {
    throw new Error(
      `Lint warning baseline exceeded: ${file} (${rule}) has ${count}; maximum ${maximum}.`,
    );
  }
}

console.log(`Lint warning baseline passed: ${warningCount} warnings; no new warning category.`);

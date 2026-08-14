import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const jsonFiles = [
  'package.json',
  'config/git-whitespace-baseline.json',
  'config/lint-warning-baseline.json',
  'docs/architecture-transition/CURRENT_PLATFORM_STATE.json',
  'docs/architecture-transition/PHASE_INDEX.json',
  'docs/product/umipos-product-roadmap.json',
  'packages/contract/generated/contract.json',
];

for (const file of jsonFiles) {
  JSON.parse(await readFile(file, 'utf8'));
}

const contractPath = 'packages/contract/generated/contract.json';
const contractBytes = await readFile(contractPath);
const expectedChecksum = (await readFile('packages/contract/generated/contract.sha256', 'utf8'))
  .trim()
  .split(/\s+/u)[0];
const actualChecksum = createHash('sha256').update(contractBytes).digest('hex');

if (actualChecksum !== expectedChecksum) {
  throw new Error('The contract artifact checksum does not match contract.sha256.');
}

const runGit = (arguments_, allowedStatus = [0]) => {
  const result = spawnSync('git', arguments_, { encoding: 'utf8' });
  if (result.error) throw result.error;
  if (!allowedStatus.includes(result.status)) {
    process.stderr.write(result.stderr);
    process.stdout.write(result.stdout);
    throw new Error(`Git check failed: git ${arguments_.join(' ')}`);
  }
  return result.stdout.trim();
};

const baseRef = process.env.PR_BASE_REF ?? 'origin/main';
const mergeBase = runGit(['merge-base', baseRef, 'HEAD']);
runGit(['diff', '--check']);
runGit(['diff', '--cached', '--check']);
const rangeCheck = runGit(['diff', '--check', `${mergeBase}...HEAD`], [0, 2]);
const whitespaceBaseline = JSON.parse(
  await readFile('config/git-whitespace-baseline.json', 'utf8'),
);
const allowedWhitespace = new Set(
  whitespaceBaseline.allowedFindings.map(
    (finding) => `${finding.path}:${finding.line}: ${finding.message}`,
  ),
);
const rangeFindings = rangeCheck.split('\n').filter((line) => /^[^+].+:\d+: /u.test(line));
const newRangeFindings = rangeFindings.filter((finding) => !allowedWhitespace.has(finding));
if (newRangeFindings.length > 0) {
  throw new Error(`New Git whitespace finding:\n${newRangeFindings.join('\n')}`);
}

console.log(
  `PR data checks passed for ${jsonFiles.length} JSON files, the contract checksum, and Git range ${mergeBase.slice(0, 12)}...HEAD.`,
);

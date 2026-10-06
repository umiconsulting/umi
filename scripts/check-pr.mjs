import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
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

// Which branch does this branch's pull request target? PRs in this repo land on
// the integration branch, so the base is the branch's own upstream. Defaulting to
// origin/main compares against a merge base thousands of commits back and reports
// every historical whitespace finding as new, which no change can clear.
const upstreamRef = () => {
  const result = spawnSync('git', ['rev-parse', '--abbrev-ref', '@{upstream}'], {
    encoding: 'utf8',
  });
  return result.status === 0 && result.stdout.trim().length > 0 ? result.stdout.trim() : null;
};
const baseRef = process.env.PR_BASE_REF ?? upstreamRef() ?? 'origin/main';
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

// ---- D3: a migration file that has already been applied is immutable -------
// A numbered file that stamps `runtime.schema_migration` has run against a live
// database. Editing it changes what a NEW database gets and does nothing to the
// one that holds the customers, so the two drift silently. That is the plan's
// D3 defect and the rule `docs/migration/build-v3/freeze.sh` states. The applied
// set is read from the files themselves — every stamping file names its own
// version — so this check needs no database. ADDING a new numbered file is a
// migration and stays allowed; only an edit, delete, rename or copy of an
// already-applied one fails.
const migrationDirectory = 'docs/migration/build-v3';
const numberedMigration = /^docs\/migration\/build-v3\/[^/]+\.sql$/u;
const migrationVersionOf = (source) =>
  /insert\s+into\s+runtime\.schema_migration[^;]*?values\s*\(\s*'([^']+)'/isu.exec(source)?.[1] ??
  null;

const appliedMigrations = new Map();
for (const name of (await readdir(migrationDirectory)).sort()) {
  if (!name.endsWith('.sql')) continue;
  const source = await readFile(`${migrationDirectory}/${name}`, 'utf8');
  const version = migrationVersionOf(source);
  if (version !== null) appliedMigrations.set(`${migrationDirectory}/${name}`, version);
}

// A deleted or renamed file is no longer in the tree above, so its stamp is read
// from the ref being compared against. For the committed range that ref is the
// merge base (the state production applied); for the working tree it is HEAD.
// That is why the check cannot be a set membership test on the working tree alone.
const migrationSourceAt = (ref, path) => {
  const result = spawnSync('git', ['show', `${ref}:${path}`], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout : null;
};

const appliedVersionOf = (path, lookupRef) => {
  const version = appliedMigrations.get(path);
  if (version !== undefined) return version;
  if (!numberedMigration.test(path)) return null;
  const baseSource = migrationSourceAt(lookupRef, path);
  return baseSource === null ? null : migrationVersionOf(baseSource);
};

const appliedMigrationsEditedIn = (entries, lookupRef) => {
  const touched = [];
  for (const entry of entries) {
    const [status, ...paths] = entry.split('\t');
    // A = added and U = unmerged stay allowed: a new numbered file is the fix.
    if (!/^[MDCR]/u.test(status)) continue;
    for (const path of paths) {
      const version = appliedVersionOf(path, lookupRef);
      if (version !== null) touched.push(`${status}\t${path}\t(applied as ${version})`);
    }
  }
  return touched;
};

// Two sources, because they answer two different questions. `mergeBase...HEAD`
// is the committed range CI sees for a real pull request, but on a dirty checkout
// with nothing committed against the base it is empty and inspects nothing. The
// working tree (`git diff --name-status HEAD`, the union of the unstaged and
// staged diffs) is what the person running the gate locally actually has, and it
// is where an unguarded edit hides. Both are scanned for edits to already-applied
// files; adding a new numbered file stays allowed (untracked, or staged as A).
const committedRangeEntries = runGit(['diff', '--name-status', `${mergeBase}...HEAD`])
  .split('\n')
  .filter((entry) => entry.length > 0);
const workingTreeEntries = runGit(['diff', '--name-status', 'HEAD'])
  .split('\n')
  .filter((entry) => entry.length > 0);

const touchedApplied = [
  ...appliedMigrationsEditedIn(committedRangeEntries, mergeBase),
  ...appliedMigrationsEditedIn(workingTreeEntries, 'HEAD'),
];

if (touchedApplied.length > 0) {
  throw new Error(
    [
      'DDL FREEZE VIOLATED. An already-applied migration file changed after it was applied.',
      ...touchedApplied.map((entry) => `  ${entry}`),
      '',
      'The live database does NOT get this edit. The fix is a migration, never an edit:',
      '  docs/migration/build-v3/migrations/  (see its README)',
    ].join('\n'),
  );
}

// Say exactly which sets were inspected. When the committed range is empty there
// was nothing to inspect there, and that must not read like a clean result.
const committedRangeSummary =
  committedRangeEntries.length === 0
    ? 'EMPTY (the merge base equals HEAD, so no committed changes exist to inspect)'
    : `${committedRangeEntries.length} change(s) inspected, no applied migration edited`;
const workingTreeSummary = `${workingTreeEntries.length} change(s) inspected, no applied migration edited`;

console.log(
  [
    `PR data checks passed for ${jsonFiles.length} JSON files and the contract checksum.`,
    `Migration freeze checked both sources, against ${appliedMigrations.size} applied migration file(s):`,
    `  committed range ${baseRef} (${mergeBase.slice(0, 12)})...HEAD: ${committedRangeSummary}`,
    `  working tree vs HEAD: ${workingTreeSummary}`,
  ].join('\n'),
);

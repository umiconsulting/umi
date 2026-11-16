import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Compare the displayed values of the before and after dashboard captures.
//
//   node tools/verification/compare-display.mjs
//
// A difference of one minor unit is a failure. Row order is significant.
const ROOT = 'docs/verification/2026-11-16-semantic-api-gate3/dashboard';
const before = JSON.parse(readFileSync(join(ROOT, 'before/evidence.json'), 'utf8'));
const after = JSON.parse(readFileSync(join(ROOT, 'after/evidence.json'), 'utf8'));

const clean = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value.replace(/\s+/g, ' ').trim();
  if (Array.isArray(value)) return value.map(clean);
  if (typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clean(item)]));
  return value;
};

const same = (left, right) => JSON.stringify(clean(left)) === JSON.stringify(clean(right));

function rowsOf(evidence) {
  const all = [...evidence.cells, ...evidence.extras, evidence.s00];
  return new Map(all.map((cell) => [cell.id, cell]));
}

function compareCell(id, left, right) {
  const fields = [
    ['lead', left.lead, right.lead],
    ['facts', left.facts, right.facts],
    ['delta', left.delta, right.delta],
    ['narrative', left.narrative, right.narrative],
    ['paymentMix', left.paymentMix?.rows ?? [], right.paymentMix?.rows ?? []],
    ['channel', left.channelPanel?.text ?? null, right.channelPanel?.text ?? null],
    ['channelRows', left.channelPanel?.rows ?? [], right.channelPanel?.rows ?? []],
    ['series', left.series ?? [], right.series ?? []],
    ['pivotHeaders', left.pivot?.headers ?? [], right.pivot?.headers ?? []],
    ['pivotRows', left.pivot?.rows ?? [], right.pivot?.rows ?? []],
    ['pivotTotal', left.pivot?.total ?? null, right.pivot?.total ?? null],
  ];
  const differences = fields
    .filter(([, a, b]) => !same(a, b))
    .map(([field, a, b]) => ({ field, before: clean(a), after: clean(b) }));
  return { id, match: differences.length === 0, differences };
}

const left = rowsOf(before);
const right = rowsOf(after);
const ids = [...new Set([...left.keys(), ...right.keys()])];
const rows = ids.map((id) => compareCell(id, left.get(id) ?? {}, right.get(id) ?? {}));
const mismatches = rows.filter((row) => !row.match);
const seedMatch =
  before.d0 === after.d0 && before.seedSha256 === after.seedSha256 && before.head !== after.head;

const report = {
  record: '2026-11-16-semantic-api-gate3-dashboard-compare',
  createdAt: new Date().toISOString(),
  d0: after.d0,
  seedSha256: after.seedSha256,
  beforeHead: before.head,
  afterHead: after.head,
  seedMatch,
  counts: {
    cells: ids.length,
    matches: rows.length - mismatches.length,
    mismatches: mismatches.length,
  },
  rows,
};
writeFileSync(join(ROOT, 'compare.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(
  `cells=${ids.length} matches=${report.counts.matches} mismatches=${mismatches.length} seedMatch=${seedMatch}`,
);
for (const row of mismatches) {
  console.log(`MISMATCH ${row.id}`);
  for (const diff of row.differences)
    console.log(`  ${diff.field}: ${JSON.stringify(diff.before)} != ${JSON.stringify(diff.after)}`);
}
if (mismatches.length > 0 || !seedMatch) process.exitCode = 1;

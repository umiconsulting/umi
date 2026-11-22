#!/usr/bin/env node
/**
 * Routing guard for the live task-router inputs.
 *
 * Checks the selectable instructions, not a copy. Rejects a retired tracker,
 * a retired owner path, a stale owner description, and a broken legacy link.
 * The --self-test mode injects each fault into a temporary copy and proves the
 * guard fails on it.
 */
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const FILES = {
  registry: '.agents/skills/task-router/registry.md',
  resolver: '.agents/skills/task-router/node-resolver.md',
  agents: 'AGENTS.md',
  tracker: 'docs/agents/issue-tracker.md',
  agentOs: 'docs/architecture/agent-operating-system.md',
};

const RETIRED_REGISTRY_MARKER = '## Retired selection rules';

const LIVE_FORBIDDEN = [
  ['apps/umi-conversaflow', 'retired owner path'],
  ['apps/umi-logs', 'retired owner path'],
  ['static Umi owner dashboard prototype', 'stale dashboard description'],
  ['loyalty-only logic', 'stale Cash description'],
  ['Work items and specs live in **Azure Boards**', 'retired tracker instruction'],
  [
    'Work items and specs for this repository live in **Azure Boards**',
    'retired tracker instruction',
  ],
];

const REQUIRED = [
  ['registry', 'apps/umi-api', 'canonical backend owner'],
  ['registry', 'apps/umi-dashboard', 'dashboard owner'],
  ['registry', 'owner dashboard app shell', 'dashboard description'],
  ['registry', 'apps/umi-cash', 'Cash owner'],
  ['registry', 'Cash compatibility client', 'Cash description'],
  ['registry', 'Do not route to Azure Boards', 'retired tracker rejection'],
  ['resolver', '`apps/umi-api`: canonical backend', 'canonical backend owner'],
  ['resolver', '`apps/umi-dashboard`: owner dashboard app shell', 'dashboard description'],
  ['resolver', '`apps/umi-cash`: Cash compatibility client', 'Cash description'],
  ['agents', 'Umi no longer uses Azure Boards', 'retired tracker'],
  ['agents', 'canonical backend for build-v3', 'canonical backend'],
  ['tracker', 'Umi no longer uses Azure Boards', 'retired tracker'],
];

const ROUTING_CASES = [
  {
    task: 'Add a shared backend endpoint for customer identity',
    owner: 'apps/umi-api',
    rule: 'Shared backend',
  },
  {
    task: 'Add a Customers tab to the owner dashboard',
    owner: 'apps/umi-dashboard',
    rule: 'Owner dashboard app shell',
  },
  {
    task: 'Fix Cash wallet-pass forwarding',
    owner: 'apps/umi-cash',
    rule: 'Cash compatibility client',
  },
  {
    task: 'Reproduce an offline POS checkout replay',
    owner: 'apps/umi-pos',
    rule: 'offline replay',
  },
  {
    task: 'Capture a new landing-page lead',
    owner: 'apps/umi-landing-page',
    rule: 'Public landing',
  },
  {
    task: 'Triage the pending work item',
    owner: 'run record',
    rule: 'Current requirements and pending work',
  },
];

function read(root, key) {
  return readFileSync(path.join(root, FILES[key]), 'utf8');
}

function liveRegistry(text) {
  const at = text.indexOf(RETIRED_REGISTRY_MARKER);
  return at === -1 ? text : text.slice(0, at);
}

function liveResolver(text) {
  // Scan the whole file. The stale-path rejection sits below the old cut point.
  // Drop the explicit history sentence: it names the retired paths to forbid them.
  return text
    .split('\n')
    .filter((line) => !/are not in the current tree\. Do not use them as owners\./i.test(line))
    .join('\n');
}

function checkLinks(root, errors) {
  const file = FILES.agentOs;
  const text = read(root, 'agentOs');
  const dir = path.dirname(path.join(root, file));
  const links = [...text.matchAll(/\]\(([^)]+)\)/g)].map((m) => m[1]);
  if (links.length === 0) {
    errors.push(`${file}: no markdown links found`);
    return 0;
  }
  for (const link of links) {
    if (/^(https?:|#|mailto:)/.test(link)) continue;
    const target = link.split('#')[0];
    if (!existsSync(path.resolve(dir, target))) {
      errors.push(`${file}: broken link ${link}`);
    }
  }
  if (/\/Users\/|\/home\//.test(text)) {
    errors.push(`${file}: absolute host path in a link or text`);
  }
  return links.length;
}

export function checkRepo(root) {
  const errors = [];
  const notes = [];
  const registry = read(root, 'registry');
  const resolver = read(root, 'resolver');
  const agents = read(root, 'agents');
  const tracker = read(root, 'tracker');
  const live = {
    registry: liveRegistry(registry),
    resolver: liveResolver(resolver),
    agents,
    tracker,
  };

  for (const [key, text] of Object.entries(live)) {
    for (const [needle, reason] of LIVE_FORBIDDEN) {
      if (text.includes(needle)) {
        errors.push(`${FILES[key]}: ${reason}: "${needle}"`);
      }
    }
  }

  for (const [key, needle, reason] of REQUIRED) {
    if (!live[key].toLowerCase().includes(needle.toLowerCase())) {
      errors.push(`${FILES[key]}: missing ${reason}: "${needle}"`);
    }
  }

  if (live.registry.includes('triage-work-items-with-codegraph')) {
    errors.push(`${FILES.registry}: retired triage skill is still selectable`);
  }

  const linkCount = checkLinks(root, errors);

  // Verify `.claude/skills` stays a symlink to `../.agents/skills` (one source of truth).
  const claudeSkills = path.join(root, '.claude/skills');
  if (existsSync(claudeSkills)) {
    const stat = lstatSync(claudeSkills);
    if (!stat.isSymbolicLink()) {
      errors.push('.claude/skills must be a symlink to ../.agents/skills (found non-symlink)');
    } else if (readlinkSync(claudeSkills) !== '../.agents/skills') {
      errors.push(
        `.claude/skills symlink points to "${readlinkSync(claudeSkills)}", expected "../.agents/skills"`,
      );
    }
  }

  // Verify every skill listed under `## Skills` in registry.md exists on disk.
  const skillsBlock = live.registry.split('## Selection rules')[0] || '';
  const registeredSkills = [...skillsBlock.matchAll(/^- `([a-z0-9-]+)`$/gm)].map((m) => m[1]);
  for (const name of registeredSkills) {
    const skillPath = path.join(root, '.agents/skills', name, 'SKILL.md');
    if (!existsSync(skillPath)) {
      errors.push(
        `${FILES.registry}: registered skill "${name}" missing .agents/skills/${name}/SKILL.md`,
      );
    }
  }

  const ruleLines = live.registry
    .split('\n')
    .map((line) => line.toLowerCase())
    .filter((line) => line.trimStart().startsWith('- '));
  const cases = ROUTING_CASES.map((item) => {
    const line = ruleLines.find(
      (candidate) =>
        candidate.includes(item.rule.toLowerCase()) && candidate.includes(item.owner.toLowerCase()),
    );
    const pass = Boolean(line);
    if (!pass) {
      errors.push(`routing case "${item.task}": expected ${item.owner} via "${item.rule}"`);
    }
    return { ...item, pass };
  });

  notes.push(`live routing files: ${Object.keys(live).length}`);
  notes.push(`representative routes: ${cases.filter((c) => c.pass).length}/${cases.length}`);
  notes.push(`agent-os links checked: ${linkCount}`);

  return { errors, notes, cases };
}

function copyRepo(src, dst) {
  for (const file of Object.values(FILES)) {
    const target = path.join(dst, file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, readFileSync(path.join(src, file)));
  }
  const claudeSrc = path.join(src, '.claude/skills');
  if (existsSync(claudeSrc) && lstatSync(claudeSrc).isSymbolicLink()) {
    const claudeDst = path.join(dst, '.claude/skills');
    mkdirSync(path.dirname(claudeDst), { recursive: true });
    symlinkSync(readlinkSync(claudeSrc), claudeDst);
  }
  const skillsDir = path.join(src, '.agents/skills');
  const regText = liveRegistry(readFileSync(path.join(src, FILES.registry), 'utf8'));
  const skillsBlock = regText.split('## Selection rules')[0] || '';
  for (const [, name] of skillsBlock.matchAll(/^- `([a-z0-9-]+)`$/gm)) {
    const skillFile = path.join(skillsDir, name, 'SKILL.md');
    if (!existsSync(skillFile)) continue;
    const dstSkill = path.join(dst, '.agents/skills', name, 'SKILL.md');
    mkdirSync(path.dirname(dstSkill), { recursive: true });
    copyFileSync(skillFile, dstSkill);
  }
  const osFile = path.join(src, FILES.agentOs);
  const osDir = path.dirname(osFile);
  for (const [, link] of readFileSync(osFile, 'utf8').matchAll(/\]\(([^)]+)\)/g)) {
    if (/^(https?:|#|mailto:)/.test(link)) continue;
    const relative = link.split('#')[0];
    const source = path.resolve(osDir, relative);
    if (!existsSync(source)) continue;
    const target = path.resolve(dst, FILES.agentOs, '..', relative);
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(source, target);
  }
}

function writeFixture(root, file, text) {
  writeFileSync(path.join(root, file), text);
}

export function selfTest() {
  const results = [];
  const baseline = checkRepo(REPO_ROOT);
  if (baseline.errors.length > 0) {
    return [
      {
        name: 'clean fixture baseline',
        pass: false,
        error: `clean tree has ${baseline.errors.length} error(s): ${baseline.errors[0]}`,
      },
    ];
  }
  const run = (name, mutate, expected) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'task-router-fault-'));
    try {
      copyRepo(REPO_ROOT, dir);
      mutate(dir);
      const result = checkRepo(dir);
      const hit = result.errors.find((error) => error.includes(expected));
      const unrelatedLinkFault =
        expected !== 'broken link' && result.errors.some((error) => error.includes('broken link'));
      const pass = Boolean(hit) && !unrelatedLinkFault;
      results.push({
        name,
        pass,
        error: pass
          ? hit
          : hit
            ? `unrelated fault: ${result.errors.find((error) => error.includes('broken link'))}`
            : `expected "${expected}"; got ${result.errors[0] ?? 'no failure'}`,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  run(
    'stale owner path is rejected',
    (dir) => {
      const file = FILES.registry;
      const text = readFileSync(path.join(dir, file), 'utf8');
      writeFixture(
        dir,
        file,
        text.replace(
          '## Selection rules',
          '## Selection rules\n\n- Shared backend: `apps/umi-conversaflow`.',
        ),
      );
    },
    'retired owner path',
  );

  run(
    'retired tracker is rejected',
    (dir) => {
      const file = FILES.agents;
      const text = readFileSync(path.join(dir, file), 'utf8');
      writeFixture(
        dir,
        file,
        text.replace(
          'Umi no longer uses Azure Boards',
          'Work items and specs live in **Azure Boards**',
        ),
      );
    },
    'retired tracker instruction',
  );

  run(
    'missing canonical owner is rejected',
    (dir) => {
      const file = FILES.resolver;
      const text = readFileSync(path.join(dir, file), 'utf8');
      writeFixture(dir, file, text.replace('`apps/umi-api`: canonical backend', '`apps/umi-api`'));
    },
    'missing canonical backend owner',
  );

  run(
    'broken legacy link is rejected',
    (dir) => {
      const file = FILES.agentOs;
      const text = readFileSync(path.join(dir, file), 'utf8');
      writeFixture(dir, file, text.replace('](../../AGENTS.md)', '](../../AGENTS-MISSING.md)'));
    },
    'broken link',
  );

  run(
    'resolver retired owner is rejected',
    (dir) => {
      const file = FILES.resolver;
      const text = readFileSync(path.join(dir, file), 'utf8');
      writeFixture(
        dir,
        file,
        text.replace(
          'Historical paths `apps/umi-conversaflow` and `apps/umi-logs` are not in the current tree. Do not use them as owners. Keep old references as history only.',
          'Shared backend owner: `apps/umi-conversaflow`.',
        ),
      );
    },
    'retired owner path',
  );

  run(
    'weakened triage rule is rejected',
    (dir) => {
      const file = FILES.registry;
      const text = readFileSync(path.join(dir, file), 'utf8');
      writeFixture(
        dir,
        file,
        text.replace(
          "Current requirements and pending work: the user's current instruction, the active task brief, and the run record.",
          "Current requirements and pending work: the user's current instruction.",
        ),
      );
    },
    'routing case "Triage the pending work item"',
  );

  return results;
}

function print(result) {
  for (const note of result.notes) console.log(`note: ${note}`);
  for (const item of result.cases) {
    console.log(`${item.pass ? 'PASS' : 'FAIL'}  ${item.task} -> ${item.owner}`);
  }
  if (result.errors.length > 0) {
    console.error(`\nFAIL: ${result.errors.length} routing error(s)`);
    for (const error of result.errors) console.error(`- ${error}`);
    return 1;
  }
  console.log('\nPASS: live routing inputs are current');
  return 0;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--self-test')) {
    const results = selfTest();
    let code = 0;
    for (const item of results) {
      console.log(`${item.pass ? 'PASS' : 'FAIL'}  ${item.name}: ${item.error}`);
      if (!item.pass) code = 1;
    }
    process.exit(code);
  }
  process.exit(print(checkRepo(REPO_ROOT)));
}

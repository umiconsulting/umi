#!/usr/bin/env node
/**
 * Routing guard for the live task-router inputs.
 *
 * Checks the selectable instructions, not a copy. Rejects a retired tracker,
 * a retired owner path, a stale owner description, and a broken legacy link.
 * The --self-test mode injects each fault into a temporary copy and proves the
 * guard fails on it.
 */
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
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
const RESOLVER_HISTORY_MARKER = '## Applicability check before an effect';

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
    rule: 'named run record',
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
  const at = text.indexOf(RESOLVER_HISTORY_MARKER);
  return at === -1 ? text : text.slice(0, at);
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

  const cases = ROUTING_CASES.map((item) => {
    const rulePresent = live.registry.toLowerCase().includes(item.rule.toLowerCase());
    const ownerPresent = live.registry.toLowerCase().includes(item.owner.toLowerCase());
    const pass = rulePresent && ownerPresent;
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
}

function writeFixture(root, file, text) {
  writeFileSync(path.join(root, file), text);
}

export function selfTest() {
  const results = [];
  const run = (name, mutate) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'task-router-fault-'));
    try {
      copyRepo(REPO_ROOT, dir);
      mutate(dir);
      const result = checkRepo(dir);
      const pass = result.errors.length > 0;
      results.push({ name, pass, error: result.errors[0] ?? 'no failure detected' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  run('stale owner path is rejected', (dir) => {
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
  });

  run('retired tracker is rejected', (dir) => {
    const file = FILES.agents;
    const text = readFileSync(path.join(dir, file), 'utf8');
    writeFixture(
      dir,
      file,
      text.replace(
        'Umi no longer uses Azure Boards.',
        'Work items and specs live in **Azure Boards**.',
      ),
    );
  });

  run('missing canonical owner is rejected', (dir) => {
    const file = FILES.resolver;
    const text = readFileSync(path.join(dir, file), 'utf8');
    writeFixture(dir, file, text.replace('`apps/umi-api`: canonical backend', '`apps/umi-api`'));
  });

  run('broken legacy link is rejected', (dir) => {
    const file = FILES.agentOs;
    const text = readFileSync(path.join(dir, file), 'utf8');
    writeFixture(dir, file, text.replace('](../../AGENTS.md)', '](../../AGENTS-MISSING.md)'));
  });

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

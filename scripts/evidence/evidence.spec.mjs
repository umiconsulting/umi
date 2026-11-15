// Evaluator self-tests. Every required rejection case has a positive and a
// negative fixture. The fixtures never run the real unit suite.

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { policyDigest, sha256Buffer } from './evidence.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(here, 'evidence.mjs');

function writeJson(absPath, value) {
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, `${JSON.stringify(value, null, 2)}\n`);
}

function makePolicy({ root, checks, requiredCheckIds }) {
  const policy = {
    schemaVersion: '1',
    coverage: { enforced: true, requiredCheckIds },
    packetsDir: 'scripts/evidence/runs',
    checks,
  };
  writeJson(path.join(root, 'scripts/evidence/policy.json'), policy);
  return policy;
}

function buildPacket({ root, policy, checkId, stdout, stderr }) {
  const check = policy.checks.find((entry) => entry.id === checkId);
  const stdoutPath = path.join(root, policy.packetsDir, checkId, 'stdout.log');
  const stderrPath = path.join(root, policy.packetsDir, checkId, 'stderr.log');
  fs.mkdirSync(path.dirname(stdoutPath), { recursive: true });
  fs.writeFileSync(stdoutPath, stdout);
  fs.writeFileSync(stderrPath, stderr);
  return {
    schemaVersion: '1',
    runId: `run-${checkId}`,
    createdAt: new Date().toISOString(),
    contentView: 'working-tree',
    policySha256: policyDigest(policy),
    check: { id: check.id, argv: [...check.argv], cwd: check.cwd },
    capture: { tool: 'test-fixture', version: '1.0.0' },
    logs: {
      stdout: {
        path: path.relative(root, stdoutPath).split(path.sep).join('/'),
        sha256: sha256Buffer(stdout),
        bytes: Buffer.byteLength(stdout),
      },
      stderr: {
        path: path.relative(root, stderrPath).split(path.sep).join('/'),
        sha256: sha256Buffer(stderr),
        bytes: Buffer.byteLength(stderr),
      },
    },
    outcome: { exitCode: 0, signal: null },
    tested: check.tested.map((entry) => {
      const bytes = fs.readFileSync(path.join(root, entry));
      return { path: entry, sha256: sha256Buffer(bytes), bytes: bytes.length };
    }),
  };
}

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-spec-'));
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src/fixture.txt'), 'fixture-content\n');
  const policy = makePolicy({
    root,
    requiredCheckIds: ['fixture'],
    checks: [
      {
        id: 'fixture',
        argv: ['node', '-e', "process.stdout.write('fixture-ok\\n')"],
        cwd: '.',
        tested: ['src/fixture.txt'],
        minStdoutBytes: 1,
      },
    ],
  });
  const packet = buildPacket({
    root,
    policy,
    checkId: 'fixture',
    stdout: 'fixture-ok\n',
    stderr: '',
  });
  const packetPath = path.join(root, policy.packetsDir, 'fixture', 'packet.json');
  writeJson(packetPath, packet);
  return { root, policy, packet, packetPath };
}

const CHANGE_INPUT_RUNNER = [
  "import fs from 'node:fs';",
  "const target = 'src/fixture.txt';",
  "const value = fs.readFileSync(target, 'utf8').trim();",
  'process.stdout.write(`CHECKED INPUT: ${value}\\n`);',
  "fs.writeFileSync(target, 'NEW\\n');",
].join('\n');

const DELETE_INPUT_RUNNER = [
  "import fs from 'node:fs';",
  "const target = 'src/fixture.txt';",
  "const value = fs.readFileSync(target, 'utf8').trim();",
  'process.stdout.write(`CHECKED INPUT: ${value}\\n`);',
  'fs.rmSync(target);',
].join('\n');

const STABLE_INPUT_RUNNER = [
  "import fs from 'node:fs';",
  "process.stdout.write(fs.readFileSync('src/fixture.txt', 'utf8'));",
].join('\n');

const CHANGE_POLICY_RUNNER = [
  "import fs from 'node:fs';",
  "process.stdout.write('CHECKED INPUT\\n');",
  "fs.appendFileSync('scripts/evidence/policy.json', '\\n');",
].join('\n');

const NON_REGULAR_INPUT_RUNNER = [
  "import fs from 'node:fs';",
  "const target = 'src/fixture.txt';",
  "process.stdout.write('CHECKED INPUT\\n');",
  'fs.rmSync(target);',
  'fs.mkdirSync(target);',
].join('\n');

// Build a small root whose approved runner can change or remove the one tested
// input. The fixtures exercise the CLI, not an imported function.
function makeInputFixture(runnerSource) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-input-'));
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src/fixture.txt'), 'OLD\n');
  fs.writeFileSync(path.join(root, 'runner.mjs'), `${runnerSource}\n`);
  const policy = makePolicy({
    root,
    requiredCheckIds: ['input-check'],
    checks: [
      {
        id: 'input-check',
        argv: ['node', 'runner.mjs'],
        cwd: '.',
        tested: ['src/fixture.txt'],
        minStdoutBytes: 1,
      },
    ],
  });
  return {
    root,
    policy,
    packetPath: path.join(root, policy.packetsDir, 'input-check', 'packet.json'),
  };
}

function run(root, args) {
  return spawnSync(process.execPath, [cli, ...args, '--root', root], {
    cwd: root,
    encoding: 'utf8',
  });
}

function reread(absPath) {
  return JSON.parse(fs.readFileSync(absPath, 'utf8'));
}

test('P1 valid packet exits 0 and is accepted', () => {
  const fixture = makeFixture();
  const result = run(fixture.root, ['check']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /ACCEPT fixture/);
});

test('P1 valid packet is accepted with a pnpm-style leading --', () => {
  const fixture = makeFixture();
  const result = run(fixture.root, ['check', '--']);
  assert.equal(result.status, 0, result.stderr);
});

test('N1 missing log is rejected', () => {
  const fixture = makeFixture();
  fs.rmSync(path.join(fixture.root, 'scripts/evidence/runs/fixture/stdout.log'));
  const result = run(fixture.root, ['check']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /N1 log missing/);
});

test('N2 stale tested-file hash is rejected', () => {
  const fixture = makeFixture();
  const packet = reread(fixture.packetPath);
  packet.tested[0].sha256 = '0'.repeat(64);
  writeJson(fixture.packetPath, packet);
  const result = run(fixture.root, ['check']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /N2 tested hash mismatch/);
});

test('N3 tampered log digest is rejected', () => {
  const fixture = makeFixture();
  fs.appendFileSync(
    path.join(fixture.root, 'scripts/evidence/runs/fixture/stdout.log'),
    'tampered',
  );
  const result = run(fixture.root, ['check']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /N3 log digest mismatch|N10 log length mismatch/);
});

test('N4 nonzero exit is rejected', () => {
  const fixture = makeFixture();
  const packet = reread(fixture.packetPath);
  packet.outcome.exitCode = 7;
  writeJson(fixture.packetPath, packet);
  const result = run(fixture.root, ['check']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /N4 outcome: exit code 7/);
});

test('N4 terminating signal is rejected', () => {
  const fixture = makeFixture();
  const packet = reread(fixture.packetPath);
  packet.outcome.signal = 'SIGKILL';
  writeJson(fixture.packetPath, packet);
  const result = run(fixture.root, ['check']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /N4 outcome: process terminated by signal SIGKILL/);
});

test('N5 malformed JSON is rejected', () => {
  const fixture = makeFixture();
  fs.writeFileSync(fixture.packetPath, '{not json');
  const result = run(fixture.root, ['check']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /N5 schema/);
});

test('N5 missing field is rejected', () => {
  const fixture = makeFixture();
  const packet = reread(fixture.packetPath);
  delete packet.createdAt;
  writeJson(fixture.packetPath, packet);
  const result = run(fixture.root, ['check']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /N5 schema: packet.createdAt is required/);
});

test('N5 wrong type is rejected', () => {
  const fixture = makeFixture();
  const packet = reread(fixture.packetPath);
  packet.check.argv = 'node';
  writeJson(fixture.packetPath, packet);
  const result = run(fixture.root, ['check']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /N5 schema: packet.check.argv must be an array/);
});

test('N5 unknown field is rejected', () => {
  const fixture = makeFixture();
  const packet = reread(fixture.packetPath);
  packet.extra = true;
  writeJson(fixture.packetPath, packet);
  const result = run(fixture.root, ['check']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /N5 schema: packet.extra is not an allowed field/);
});

test('N6 missing required packet is rejected', () => {
  const fixture = makeFixture();
  fs.rmSync(fixture.packetPath);
  const result = run(fixture.root, ['check']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /N6 missing required packet/);
});

test('N6 a packet in the wrong required slot is rejected', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-slot-'));
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src/fixture.txt'), 'fixture-content\n');
  const command = ['node', '-e', "process.stdout.write('fixture-ok\\n')"];
  const policy = makePolicy({
    root,
    requiredCheckIds: ['other'],
    checks: [
      { id: 'fixture', argv: command, cwd: '.', tested: ['src/fixture.txt'], minStdoutBytes: 1 },
      { id: 'other', argv: command, cwd: '.', tested: ['src/fixture.txt'], minStdoutBytes: 1 },
    ],
  });
  const packet = buildPacket({
    root,
    policy,
    checkId: 'fixture',
    stdout: 'fixture-ok\n',
    stderr: '',
  });
  writeJson(path.join(root, policy.packetsDir, 'other/packet.json'), packet);
  const result = run(root, ['check']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /N6 packet slot mismatch/);
});

test('N7 duplicate tested path is rejected', () => {
  const fixture = makeFixture();
  const packet = reread(fixture.packetPath);
  packet.tested.push({ ...packet.tested[0] });
  writeJson(fixture.packetPath, packet);
  const result = run(fixture.root, ['check']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /N7 duplicate tested path/);
});

test('N8 absolute tested path is rejected', () => {
  const fixture = makeFixture();
  const packet = reread(fixture.packetPath);
  packet.tested[0].path = '/etc/hostname';
  writeJson(fixture.packetPath, packet);
  const result = run(fixture.root, ['check']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /N8 path: tested \/etc\/hostname is absolute/);
});

test('N8 parent traversal is rejected', () => {
  const fixture = makeFixture();
  const packet = reread(fixture.packetPath);
  packet.tested[0].path = '../outside.txt';
  writeJson(fixture.packetPath, packet);
  const result = run(fixture.root, ['check']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /N8 path: tested \.\.\/outside\.txt is outside the root/);
});

test('N8 symlink escape is rejected', () => {
  const fixture = makeFixture();
  const outside = path.join(os.tmpdir(), `evidence-outside-${crypto.randomUUID()}.txt`);
  fs.writeFileSync(outside, 'outside-content\n');
  const stdoutPath = path.join(fixture.root, 'scripts/evidence/runs/fixture/stdout.log');
  fs.rmSync(stdoutPath);
  fs.symlinkSync(outside, stdoutPath);
  const bytes = fs.readFileSync(outside);
  const packet = reread(fixture.packetPath);
  packet.logs.stdout.sha256 = sha256Buffer(bytes);
  packet.logs.stdout.bytes = bytes.length;
  writeJson(fixture.packetPath, packet);
  const result = run(fixture.root, ['check']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /N8 path: logs\.stdout\.path escapes the root through a symlink/);
});

test('N9 unapproved command id is rejected', () => {
  const fixture = makeFixture();
  const packet = reread(fixture.packetPath);
  packet.check.id = 'ghost';
  writeJson(fixture.packetPath, packet);
  const result = run(fixture.root, ['check']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /N9 command identity: command id "ghost" is not in policy/);
});

test('N9 argv mismatch is rejected', () => {
  const fixture = makeFixture();
  const packet = reread(fixture.packetPath);
  packet.check.argv.push('--extra');
  writeJson(fixture.packetPath, packet);
  const result = run(fixture.root, ['check']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /N9 command identity: argv does not match policy/);
});

test('N9 cwd mismatch is rejected', () => {
  const fixture = makeFixture();
  const packet = reread(fixture.packetPath);
  packet.check.cwd = 'src';
  writeJson(fixture.packetPath, packet);
  const result = run(fixture.root, ['check']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /N9 command identity: cwd does not match policy/);
});

test('N10 empty log is rejected', () => {
  const fixture = makeFixture();
  const stdoutPath = path.join(fixture.root, 'scripts/evidence/runs/fixture/stdout.log');
  fs.writeFileSync(stdoutPath, '');
  const packet = reread(fixture.packetPath);
  packet.logs.stdout.sha256 = sha256Buffer(Buffer.alloc(0));
  packet.logs.stdout.bytes = 0;
  writeJson(fixture.packetPath, packet);
  const result = run(fixture.root, ['check']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /N10 log empty/);
});

test('N10 partial log is rejected', () => {
  const fixture = makeFixture();
  const packet = reread(fixture.packetPath);
  packet.logs.stdout.bytes += 10;
  writeJson(fixture.packetPath, packet);
  const result = run(fixture.root, ['check']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /N10 log length mismatch \(partial log\)/);
});

test('policy digest mismatch is rejected', () => {
  const fixture = makeFixture();
  const policy = reread(path.join(fixture.root, 'scripts/evidence/policy.json'));
  policy.checks[0].minStdoutBytes = 2;
  writeJson(path.join(fixture.root, 'scripts/evidence/policy.json'), policy);
  const result = run(fixture.root, ['check']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /POLICY digest mismatch/);
});

test('missing policy is rejected', () => {
  const fixture = makeFixture();
  fs.rmSync(path.join(fixture.root, 'scripts/evidence/policy.json'));
  const result = run(fixture.root, ['check']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /N0 policy missing/);
});

test('policy with disabled coverage is rejected', () => {
  const fixture = makeFixture();
  const policy = reread(path.join(fixture.root, 'scripts/evidence/policy.json'));
  policy.coverage.enforced = false;
  writeJson(path.join(fixture.root, 'scripts/evidence/policy.json'), policy);
  const result = run(fixture.root, ['check']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /P1 policy: coverage\.enforced must be true/);
});

test('policy with an undefined required check is rejected', () => {
  const fixture = makeFixture();
  const policy = reread(path.join(fixture.root, 'scripts/evidence/policy.json'));
  policy.coverage.requiredCheckIds = ['ghost'];
  writeJson(path.join(fixture.root, 'scripts/evidence/policy.json'), policy);
  const result = run(fixture.root, ['check']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /P1 policy: required check "ghost" is not defined/);
});

test('a packet required:false field is not authoritative', () => {
  const fixture = makeFixture();
  const packet = reread(fixture.packetPath);
  packet.required = false;
  writeJson(fixture.packetPath, packet);
  const result = run(fixture.root, ['check']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /ACCEPT fixture/);
});

test('the validator never executes the command in a packet', () => {
  const fixture = makeFixture();
  const policy = reread(path.join(fixture.root, 'scripts/evidence/policy.json'));
  policy.checks[0].argv = ['node', '-e', "require('fs').writeFileSync('executed.txt','yes')"];
  writeJson(path.join(fixture.root, 'scripts/evidence/policy.json'), policy);
  const packet = buildPacket({
    root: fixture.root,
    policy,
    checkId: 'fixture',
    stdout: 'fixture-ok\n',
    stderr: '',
  });
  writeJson(fixture.packetPath, packet);
  const result = run(fixture.root, ['check']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(path.join(fixture.root, 'executed.txt')), false);
});

test('capture runs an approved command and records the real exit', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-capture-'));
  const policy = makePolicy({
    root,
    requiredCheckIds: ['capture-ok'],
    checks: [
      {
        id: 'capture-ok',
        argv: ['node', '-e', "process.stdout.write('captured-ok')"],
        cwd: '.',
        tested: ['package.json'],
        minStdoutBytes: 1,
      },
    ],
  });
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"fixture"}\n');
  const result = run(root, ['capture', '--check-id', 'capture-ok']);
  assert.equal(result.status, 0, result.stderr);
  const packet = reread(path.join(root, policy.packetsDir, 'capture-ok/packet.json'));
  assert.equal(packet.outcome.exitCode, 0);
  assert.equal(packet.contentView, 'working-tree');
  assert.equal(fs.readFileSync(path.join(root, packet.logs.stdout.path), 'utf8'), 'captured-ok');
});

test('capture records a nonzero child exit and the validator rejects it', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-capture-fail-'));
  const policy = makePolicy({
    root,
    requiredCheckIds: ['capture-fail'],
    checks: [
      {
        id: 'capture-fail',
        argv: ['node', '-e', "process.stderr.write('bad'); process.exit(3)"],
        cwd: '.',
        tested: ['package.json'],
        minStdoutBytes: 0,
      },
    ],
  });
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"fixture"}\n');
  const captured = run(root, ['capture', '--check-id', 'capture-fail']);
  assert.equal(captured.status, 3);
  const packet = reread(path.join(root, policy.packetsDir, 'capture-fail/packet.json'));
  assert.equal(packet.outcome.exitCode, 3);
  const checked = run(root, ['check']);
  assert.equal(checked.status, 1);
  assert.match(checked.stderr, /N4 outcome: exit code 3/);
});

test('capture rejects a tested input changed during the run', () => {
  const fixture = makeInputFixture(CHANGE_INPUT_RUNNER);
  const result = run(fixture.root, ['capture', '--check-id', 'input-check']);
  assert.equal(result.status, 1, result.stderr);
  assert.match(
    result.stderr,
    /REJECT N11 tested input changed during the run: src\/fixture\.txt \(before=[0-9a-f]{64} \([0-9]+ bytes\), after=[0-9a-f]{64} \([0-9]+ bytes\)\)/,
  );
  assert.equal(fs.existsSync(fixture.packetPath), false);
});

test('check:ci rejects a tested input changed during the run', () => {
  const fixture = makeInputFixture(CHANGE_INPUT_RUNNER);
  const result = run(fixture.root, ['check:ci']);
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /check:ci input-check: N11 tested input changed during the run: src\/fixture\.txt/,
  );
  assert.equal(fs.existsSync(path.join(fixture.root, 'scripts/evidence/.ci-tmp')), false);
});

test('capture accepts a stable tested input', () => {
  const fixture = makeInputFixture(STABLE_INPUT_RUNNER);
  const captured = run(fixture.root, ['capture', '--check-id', 'input-check']);
  assert.equal(captured.status, 0, captured.stderr);
  const packet = reread(fixture.packetPath);
  assert.equal(packet.tested[0].sha256, sha256Buffer(Buffer.from('OLD\n')));
  const checked = run(fixture.root, ['check']);
  assert.equal(checked.status, 0, checked.stderr);
  assert.match(checked.stdout, /ACCEPT input-check/);
});

test('capture rejects a tested input removed during the run', () => {
  const fixture = makeInputFixture(DELETE_INPUT_RUNNER);
  const result = run(fixture.root, ['capture', '--check-id', 'input-check']);
  assert.equal(result.status, 1, result.stderr);
  assert.match(
    result.stderr,
    /REJECT N11 tested input removed during the run: src\/fixture\.txt \(before=/,
  );
  assert.equal(fs.existsSync(fixture.packetPath), false);
});

test('capture rejects a tested input replaced by a non-regular file', () => {
  const fixture = makeInputFixture(NON_REGULAR_INPUT_RUNNER);
  const result = run(fixture.root, ['capture', '--check-id', 'input-check']);
  assert.equal(result.status, 1, result.stderr);
  assert.match(
    result.stderr,
    /REJECT N11 tested input is not a regular file after the run: src\/fixture\.txt/,
  );
  assert.equal(fs.existsSync(fixture.packetPath), false);
});

test('capture rejects a policy file changed during the run', () => {
  const fixture = makeInputFixture(CHANGE_POLICY_RUNNER);
  const result = run(fixture.root, ['capture', '--check-id', 'input-check']);
  assert.equal(result.status, 1, result.stderr);
  assert.match(
    result.stderr,
    /REJECT N11 policy file changed during the run: scripts\/evidence\/policy\.json \(before=/,
  );
  assert.equal(fs.existsSync(fixture.packetPath), false);
});

test('check:ci re-executes the approved command', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-ci-'));
  makePolicy({
    root,
    requiredCheckIds: ['ci-ok'],
    checks: [
      {
        id: 'ci-ok',
        argv: [
          'node',
          '-e',
          "require('fs').writeFileSync('ci-marker.txt','ran'); process.stdout.write('ci')",
        ],
        cwd: '.',
        tested: ['package.json'],
        minStdoutBytes: 1,
      },
    ],
  });
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"fixture"}\n');
  const result = run(root, ['check:ci']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(path.join(root, 'ci-marker.txt'), 'utf8'), 'ran');
  assert.equal(fs.existsSync(path.join(root, 'scripts/evidence/.ci-tmp')), false);
});

test('check:ci rejects a failing command and never trusts a stored exit', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-ci-fail-'));
  makePolicy({
    root,
    requiredCheckIds: ['ci-fail'],
    checks: [
      {
        id: 'ci-fail',
        argv: ['node', '-e', 'process.exit(4)'],
        cwd: '.',
        tested: ['package.json'],
        minStdoutBytes: 0,
      },
    ],
  });
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"fixture"}\n');
  const result = run(root, ['check:ci']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /check:ci capture failed for "ci-fail": exit 4/);
});

test('capture refuses an unapproved check id', () => {
  const fixture = makeFixture();
  const result = run(fixture.root, ['capture', '--check-id', 'ghost']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /N9 command identity: command id "ghost" is not in policy/);
});

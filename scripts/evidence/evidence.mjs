#!/usr/bin/env node
// Automatic evidence evaluator.
//
// Commands:
//   check     validate checked-in policy and every required packet
//   capture   run one policy-approved command and write a packet
//   check:ci  re-execute every required command and validate the fresh packets
//
// The validator never executes an argv string from a packet. It resolves the
// command ID through checked-in policy and compares the packet to that policy.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PACKET_SPEC, POLICY_SPEC, SCHEMA_VERSION, schemaDocument } from './schema.mjs';

const TOOL = 'scripts/evidence/evidence.mjs';
const TOOL_VERSION = '1.0.0';
const DEFAULT_POLICY = 'scripts/evidence/policy.json';

class EvidenceError extends Error {}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function fail(message) {
  throw new EvidenceError(message);
}

function readJsonFile(absPath, label) {
  let text;
  try {
    text = fs.readFileSync(absPath, 'utf8');
  } catch (error) {
    fail(`${label} cannot be read: ${error.code ?? error.message}`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    fail(`${label} is not valid JSON: ${error.message}`);
  }
}

// Write JSON in the shape Prettier produces for this packet: objects stay
// expanded, short arrays of primitives stay inline. A captured packet must be
// stable under `prettier --check`.
function formatJson(value, indent = 0, prefixLength = 0) {
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const simple = value.every((item) => item === null || typeof item !== 'object');
    const inline = `[${value.map((item) => JSON.stringify(item)).join(', ')}]`;
    if (simple && prefixLength + inline.length <= 100) return inline;
    const pad = ' '.repeat(indent);
    return `[\n${value.map((item) => `${pad}  ${formatJson(item, indent + 2)}`).join(',\n')}\n${pad}]`;
  }
  if (isPlainObject(value)) {
    const keys = Object.keys(value);
    if (keys.length === 0) return '{}';
    const pad = ' '.repeat(indent);
    const body = keys.map((key) => {
      const keyText = `${JSON.stringify(key)}: `;
      return `${pad}  ${keyText}${formatJson(value[key], indent + 2, indent + 2 + keyText.length)}`;
    });
    return `{\n${body.join(',\n')}\n${pad}}`;
  }
  return JSON.stringify(value);
}

function writeJsonFile(absPath, value) {
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, `${formatJson(value)}\n`);
}

function sha256Buffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isPlainObject(value)) {
    const sorted = {};
    for (const key of Object.keys(value).sort()) sorted[key] = canonicalize(value[key]);
    return sorted;
  }
  return value;
}

function policyDigest(policy) {
  return sha256Buffer(Buffer.from(JSON.stringify(canonicalize(policy)), 'utf8'));
}

function validateShape(value, spec, at, errors) {
  if (spec.kind === 'object') {
    if (!isPlainObject(value)) {
      errors.push(`N5 schema: ${at} must be an object`);
      return;
    }
    for (const key of Object.keys(value)) {
      if (!spec.fields.some((field) => field.key === key)) {
        errors.push(`N5 schema: ${at}.${key} is not an allowed field`);
      }
    }
    for (const field of spec.fields) {
      const fieldAt = `${at}.${field.key}`;
      if (!Object.prototype.hasOwnProperty.call(value, field.key)) {
        if (!field.optional) errors.push(`N5 schema: ${fieldAt} is required`);
        continue;
      }
      validateShape(value[field.key], field, fieldAt, errors);
    }
    return;
  }
  if (spec.kind === 'array') {
    if (!Array.isArray(value)) {
      errors.push(`N5 schema: ${at} must be an array`);
      return;
    }
    if (spec.minItems !== undefined && value.length < spec.minItems) {
      errors.push(`N5 schema: ${at} must have at least ${spec.minItems} item(s)`);
    }
    value.forEach((item, index) => validateShape(item, spec.items, `${at}[${index}]`, errors));
    return;
  }
  if (spec.kind === 'const') {
    if (value !== spec.value)
      errors.push(`N5 schema: ${at} must equal ${JSON.stringify(spec.value)}`);
    return;
  }
  if (spec.kind === 'string') {
    if (typeof value !== 'string') {
      errors.push(`N5 schema: ${at} must be a string`);
      return;
    }
    if (spec.nonEmpty && value.length === 0) errors.push(`N5 schema: ${at} must not be empty`);
    if (spec.pattern && !spec.pattern.test(value))
      errors.push(`N5 schema: ${at} has an invalid format`);
    return;
  }
  if (spec.kind === 'nullableString') {
    if (value !== null && typeof value !== 'string') {
      errors.push(`N5 schema: ${at} must be null or a string`);
    }
    return;
  }
  if (spec.kind === 'sha256') {
    if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) {
      errors.push(`N5 schema: ${at} must be a lowercase SHA-256 hex digest`);
    }
    return;
  }
  if (spec.kind === 'int') {
    if (!Number.isInteger(value)) {
      errors.push(`N5 schema: ${at} must be an integer`);
      return;
    }
    if (spec.min !== undefined && value < spec.min)
      errors.push(`N5 schema: ${at} is below ${spec.min}`);
    if (spec.max !== undefined && value > spec.max)
      errors.push(`N5 schema: ${at} is above ${spec.max}`);
    return;
  }
  if (spec.kind === 'boolean') {
    if (typeof value !== 'boolean') errors.push(`N5 schema: ${at} must be a boolean`);
    return;
  }
  if (spec.kind === 'enum') {
    if (!spec.values.includes(value)) {
      errors.push(`N5 schema: ${at} must be one of ${spec.values.join(', ')}`);
    }
    return;
  }
  if (spec.kind === 'isoDate') {
    if (
      typeof value !== 'string' ||
      Number.isNaN(Date.parse(value)) ||
      !/^\d{4}-\d{2}-\d{2}T/.test(value)
    ) {
      errors.push(`N5 schema: ${at} must be an ISO-8601 timestamp`);
    }
    return;
  }
  errors.push(`N5 schema: ${at} uses an unknown schema kind`);
}

function resolveRoot(root) {
  const abs = path.resolve(root ?? process.cwd());
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
    fail(`root is not a directory: ${abs}`);
  }
  return fs.realpathSync(abs);
}

function insideRoot(rootReal, absPath) {
  const rel = path.relative(rootReal, absPath);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

// Validate a packet-supplied path. Reject absolute paths, backslashes, empty
// segments, `..` traversal, and symlink escapes outside the declared root.
function resolveContained(rootReal, relativePath, label, { allowDot = false } = {}) {
  if (typeof relativePath !== 'string' || relativePath.length === 0) {
    return { error: `N8 path: ${label} is empty` };
  }
  if (path.isAbsolute(relativePath) || /^[A-Za-z]:[\\/]/.test(relativePath)) {
    return { error: `N8 path: ${label} is absolute (${relativePath})` };
  }
  if (relativePath.includes('\\')) {
    return { error: `N8 path: ${label} uses a backslash (${relativePath})` };
  }
  if (relativePath.includes('\0')) {
    return { error: `N8 path: ${label} contains a NUL byte` };
  }
  const normalized = path.posix.normalize(relativePath);
  if (normalized === '..' || normalized.startsWith('../')) {
    return { error: `N8 path: ${label} is outside the root (${relativePath})` };
  }
  if (normalized.startsWith('/')) {
    return { error: `N8 path: ${label} is absolute (${relativePath})` };
  }
  if (!allowDot && (normalized === '.' || normalized === '')) {
    return { error: `N8 path: ${label} does not name a file (${relativePath})` };
  }
  const abs = path.resolve(rootReal, normalized);
  if (!insideRoot(rootReal, abs)) {
    return { error: `N8 path: ${label} is outside the root (${relativePath})` };
  }
  // Resolve the nearest existing ancestor so a missing leaf cannot hide a
  // symlinked parent. Then resolve the leaf itself when it exists.
  let probe = abs;
  while (!fs.existsSync(probe)) {
    const parent = path.dirname(probe);
    if (parent === probe) break;
    probe = parent;
  }
  if (fs.existsSync(probe)) {
    const realProbe = fs.realpathSync(probe);
    if (!insideRoot(rootReal, realProbe)) {
      return { error: `N8 path: ${label} escapes the root through a symlink (${relativePath})` };
    }
  }
  return { abs, relative: normalized };
}

function hashFile(absPath) {
  const bytes = fs.readFileSync(absPath);
  return { sha256: sha256Buffer(bytes), bytes: bytes.length };
}

// Snapshot every declared input before the child starts. A packet must name the
// bytes that the command could read, not the bytes that remain after it exits.
function snapshotTestedInputs(rootReal, check) {
  return check.tested.map((entry) => {
    const resolved = resolveContained(rootReal, entry, 'policy.tested');
    if (resolved.error) fail(resolved.error);
    let stat;
    try {
      stat = fs.statSync(resolved.abs);
    } catch (error) {
      fail(`N2 tested input cannot be read: ${entry} (${error.code ?? error.message})`);
    }
    if (!stat.isFile()) {
      fail(`N2 tested input is not a regular file: ${entry}`);
    }
    return { path: entry, ...hashFile(resolved.abs) };
  });
}

function describeDigest(identity) {
  return `${identity.sha256} (${identity.bytes} bytes)`;
}

function validatePolicyShape(policy) {
  const errors = [];
  validateShape(policy, POLICY_SPEC, 'policy', errors);
  if (errors.length) return errors;
  const ids = new Set();
  for (const check of policy.checks) {
    if (ids.has(check.id)) errors.push(`P7 policy: duplicate check id "${check.id}"`);
    ids.add(check.id);
    const tested = new Set();
    for (const entry of check.tested) {
      if (tested.has(entry))
        errors.push(`P7 policy: check "${check.id}" has duplicate tested path "${entry}"`);
      tested.add(entry);
    }
    if (check.minStdoutBytes === undefined) check.minStdoutBytes = 1;
  }
  if (policy.coverage.enforced !== true) {
    errors.push('P1 policy: coverage.enforced must be true');
  }
  if (policy.coverage.requiredCheckIds.length === 0) {
    errors.push('P1 policy: coverage.requiredCheckIds must not be empty');
  }
  for (const id of policy.coverage.requiredCheckIds) {
    if (!ids.has(id)) errors.push(`P1 policy: required check "${id}" is not defined in checks`);
  }
  return errors;
}

function validatePolicyPaths(rootReal, policy) {
  const errors = [];
  const packetsDir = resolveContained(rootReal, policy.packetsDir, 'policy.packetsDir', {
    allowDot: true,
  });
  if (packetsDir.error) errors.push(packetsDir.error.replace('N8', 'P8'));
  for (const check of policy.checks) {
    const cwd = resolveContained(rootReal, check.cwd, `policy.checks.${check.id}.cwd`, {
      allowDot: true,
    });
    if (cwd.error) errors.push(cwd.error.replace('N8', 'P8'));
    else if (!fs.existsSync(cwd.abs) || !fs.statSync(cwd.abs).isDirectory()) {
      errors.push(`P8 policy: check "${check.id}" cwd does not exist (${check.cwd})`);
    }
    for (const entry of check.tested) {
      const tested = resolveContained(rootReal, entry, `policy.checks.${check.id}.tested`);
      if (tested.error) errors.push(tested.error.replace('N8', 'P8'));
      else if (!fs.existsSync(tested.abs)) {
        errors.push(`P8 policy: check "${check.id}" tested file is missing (${entry})`);
      }
    }
  }
  return errors;
}

function loadPolicy({ root, policyPath }) {
  const rootReal = resolveRoot(root);
  const absPolicy = path.resolve(rootReal, policyPath ?? DEFAULT_POLICY);
  if (!insideRoot(rootReal, absPolicy)) {
    fail(`policy path is outside the root: ${absPolicy}`);
  }
  if (!fs.existsSync(absPolicy)) {
    return { ok: false, root: rootReal, rootReal, errors: [`N0 policy missing: ${absPolicy}`] };
  }
  let policy;
  try {
    policy = readJsonFile(absPolicy, 'policy');
  } catch (error) {
    return {
      ok: false,
      root: rootReal,
      rootReal,
      errors: [`N0 policy malformed: ${error.message}`],
    };
  }
  const errors = validatePolicyShape(policy);
  if (errors.length) return { ok: false, root: rootReal, rootReal, errors };
  errors.push(...validatePolicyPaths(rootReal, policy));
  if (errors.length) return { ok: false, root: rootReal, rootReal, errors };
  return {
    ok: true,
    root: rootReal,
    rootReal,
    policy,
    policyPath: absPolicy,
    policySha256: policyDigest(policy),
    errors: [],
  };
}

function findCheck(policy, checkId) {
  return policy.checks.find((check) => check.id === checkId);
}

function validatePacket({
  rootReal,
  policy,
  policySha256,
  packet,
  expectedView,
  expectedCheckId = null,
}) {
  const errors = [];
  validateShape(packet, PACKET_SPEC, 'packet', errors);
  if (errors.length) return errors;

  if (packet.policySha256 !== policySha256) {
    errors.push(
      `POLICY digest mismatch: packet records ${packet.policySha256}, current policy is ${policySha256}`,
    );
  }
  if (packet.contentView !== expectedView) {
    errors.push(`CONTENT view mismatch: packet is ${packet.contentView}, expected ${expectedView}`);
  }
  if (expectedCheckId && packet.check.id !== expectedCheckId) {
    errors.push(
      `N6 packet slot mismatch: required check "${expectedCheckId}" contains a packet for "${packet.check.id}"`,
    );
  }

  const check = findCheck(policy, packet.check.id);
  if (!check) {
    errors.push(`N9 command identity: command id "${packet.check.id}" is not in policy`);
  } else {
    if (JSON.stringify(packet.check.argv) !== JSON.stringify(check.argv)) {
      errors.push(
        `N9 command identity: argv does not match policy for "${check.id}" (packet ${JSON.stringify(packet.check.argv)}, policy ${JSON.stringify(check.argv)})`,
      );
    }
    if (packet.check.cwd !== check.cwd) {
      errors.push(
        `N9 command identity: cwd does not match policy for "${check.id}" (packet "${packet.check.cwd}", policy "${check.cwd}")`,
      );
    }
  }

  if (packet.outcome.exitCode !== 0) {
    errors.push(`N4 outcome: exit code ${packet.outcome.exitCode} is not 0`);
  }
  if (packet.outcome.signal !== null) {
    errors.push(`N4 outcome: process terminated by signal ${packet.outcome.signal}`);
  }

  const cwd = resolveContained(rootReal, packet.check.cwd, 'check.cwd', { allowDot: true });
  if (cwd.error) errors.push(cwd.error);
  else if (!fs.existsSync(cwd.abs) || !fs.statSync(cwd.abs).isDirectory()) {
    errors.push(`N8 path: check.cwd does not exist (${packet.check.cwd})`);
  }

  const logPaths = [
    ['logs.stdout', packet.logs.stdout],
    ['logs.stderr', packet.logs.stderr],
  ];
  for (const [label, log] of logPaths) {
    const resolved = resolveContained(rootReal, log.path, `${label}.path`);
    if (resolved.error) {
      errors.push(resolved.error);
      continue;
    }
    if (!fs.existsSync(resolved.abs)) {
      errors.push(`N1 log missing: ${label} does not exist at ${log.path}`);
      continue;
    }
    const actual = hashFile(resolved.abs);
    if (actual.bytes !== log.bytes) {
      errors.push(
        `N10 log length mismatch (partial log): ${label} records ${log.bytes} bytes, actual ${actual.bytes}`,
      );
      continue;
    }
    if (actual.sha256 !== log.sha256) {
      errors.push(
        `N3 log digest mismatch: ${label} recorded ${log.sha256}, actual ${actual.sha256}`,
      );
      continue;
    }
    const minimum = label === 'logs.stdout' && check ? check.minStdoutBytes : 0;
    if (actual.bytes < minimum) {
      errors.push(
        `N10 log empty: ${label} has ${actual.bytes} bytes, policy requires at least ${minimum}`,
      );
    }
  }

  const testedPaths = new Set();
  for (const entry of packet.tested) {
    if (testedPaths.has(entry.path)) {
      errors.push(`N7 duplicate tested path: ${entry.path}`);
    }
    testedPaths.add(entry.path);
  }
  if (check) {
    const policyTested = check.tested;
    const packetTested = [...new Set(packet.tested.map((entry) => entry.path))];
    const missing = policyTested.filter((entry) => !packetTested.includes(entry));
    const extra = packetTested.filter((entry) => !policyTested.includes(entry));
    if (missing.length || extra.length) {
      errors.push(
        `N2 tested set mismatch: missing [${missing.join(', ')}], extra [${extra.join(', ')}]`,
      );
    }
  }

  for (const entry of packet.tested) {
    const resolved = resolveContained(rootReal, entry.path, `tested ${entry.path}`);
    if (resolved.error) {
      errors.push(resolved.error);
      continue;
    }
    if (!fs.existsSync(resolved.abs)) {
      errors.push(`N2 tested file missing: ${entry.path}`);
      continue;
    }
    const actual = hashFile(resolved.abs);
    if (actual.bytes !== entry.bytes) {
      errors.push(
        `N2 tested size mismatch: ${entry.path} records ${entry.bytes} bytes, actual ${actual.bytes}`,
      );
    }
    if (actual.sha256 !== entry.sha256) {
      errors.push(
        `N2 tested hash mismatch: ${entry.path} recorded ${entry.sha256}, actual ${actual.sha256}`,
      );
    }
  }

  return errors;
}

function runCheck({ root, policyPath }) {
  const loaded = loadPolicy({ root, policyPath });
  if (!loaded.ok) return loaded;
  const { rootReal, policy, policySha256 } = loaded;
  const errors = [];
  const accepted = [];
  for (const checkId of policy.coverage.requiredCheckIds) {
    const packetPath = path.join(rootReal, policy.packetsDir, checkId, 'packet.json');
    const relativePacket = path.relative(rootReal, packetPath);
    if (!fs.existsSync(packetPath)) {
      errors.push(
        `N6 missing required packet: check "${checkId}" has no packet at ${relativePacket}`,
      );
      continue;
    }
    let packet;
    try {
      packet = readJsonFile(packetPath, `packet ${checkId}`);
    } catch (error) {
      errors.push(`N5 schema: ${error.message}`);
      continue;
    }
    const packetErrors = validatePacket({
      rootReal,
      policy,
      policySha256,
      packet,
      expectedView: 'working-tree',
      expectedCheckId: checkId,
    });
    if (packetErrors.length) {
      for (const error of packetErrors) errors.push(`${checkId}: ${error}`);
    } else {
      accepted.push({ checkId, relativePacket });
    }
  }
  return { ok: errors.length === 0, root: rootReal, accepted, errors };
}

function ensurePacketsDir(rootReal, packetDir) {
  const resolved = resolveContained(rootReal, packetDir, 'packetsDir', { allowDot: true });
  if (resolved.error) fail(resolved.error);
  fs.mkdirSync(resolved.abs, { recursive: true });
  return resolved.abs;
}

function runCapture({
  root,
  policyPath,
  checkId,
  view = 'working-tree',
  outDir = null,
  runId = null,
  quiet = false,
}) {
  const loaded = loadPolicy({ root, policyPath });
  if (!loaded.ok) return { ...loaded, exitCode: 1 };
  const { rootReal, policy, policySha256 } = loaded;
  const check = findCheck(policy, checkId);
  if (!check) {
    return {
      ok: false,
      root: rootReal,
      errors: [`N9 command identity: command id "${checkId}" is not in policy`],
      exitCode: 1,
    };
  }
  const cwd = resolveContained(rootReal, check.cwd, 'policy.cwd', { allowDot: true });
  if (cwd.error) return { ok: false, root: rootReal, errors: [cwd.error], exitCode: 1 };

  const packetDir = outDir ?? path.join(rootReal, policy.packetsDir, check.id);
  const packetDirAbs = ensurePacketsDir(rootReal, path.relative(rootReal, packetDir));
  const stdoutPath = path.join(packetDirAbs, 'stdout.log');
  const stderrPath = path.join(packetDirAbs, 'stderr.log');

  // Bind the packet to the pre-run identity of every declared input and of the
  // policy file. The post-run pass below rejects a changed, removed, or
  // non-regular input. This is a before/after check, not an input snapshot.
  const preTested = snapshotTestedInputs(rootReal, check);
  const prePolicy = hashFile(loaded.policyPath);

  if (!quiet) process.stderr.write(`evidence:capture ${check.id}: ${JSON.stringify(check.argv)}\n`);
  const result = spawnSync(check.argv[0], check.argv.slice(1), {
    cwd: cwd.abs,
    env: process.env,
    encoding: 'buffer',
    maxBuffer: 256 * 1024 * 1024,
    shell: false,
  });
  if (result.error) {
    return {
      ok: false,
      root: rootReal,
      errors: [`CAPTURE failed to start "${check.argv[0]}": ${result.error.message}`],
      exitCode: 127,
    };
  }
  const stdout = result.stdout ?? Buffer.alloc(0);
  const stderr = result.stderr ?? Buffer.alloc(0);
  fs.writeFileSync(stdoutPath, stdout);
  fs.writeFileSync(stderrPath, stderr);

  const exitCode = Number.isInteger(result.status) ? result.status : 1;
  const signal = result.signal ?? null;

  const postErrors = [];
  let postPolicy;
  try {
    postPolicy = hashFile(loaded.policyPath);
  } catch {
    postErrors.push(
      `N11 policy file removed during the run: ${toPosix(
        path.relative(rootReal, loaded.policyPath),
      )}`,
    );
  }
  if (postPolicy && postPolicy.sha256 !== prePolicy.sha256) {
    postErrors.push(
      `N11 policy file changed during the run: ${toPosix(
        path.relative(rootReal, loaded.policyPath),
      )} (before=${describeDigest(prePolicy)}, after=${describeDigest(postPolicy)})`,
    );
  }
  for (const before of preTested) {
    const resolved = resolveContained(rootReal, before.path, `tested ${before.path}`);
    if (resolved.error) {
      postErrors.push(resolved.error);
      continue;
    }
    let stat;
    try {
      stat = fs.statSync(resolved.abs);
    } catch {
      postErrors.push(
        `N11 tested input removed during the run: ${before.path} (before=${describeDigest(
          before,
        )})`,
      );
      continue;
    }
    if (!stat.isFile()) {
      postErrors.push(`N11 tested input is not a regular file after the run: ${before.path}`);
      continue;
    }
    const after = hashFile(resolved.abs);
    if (after.sha256 !== before.sha256 || after.bytes !== before.bytes) {
      postErrors.push(
        `N11 tested input changed during the run: ${before.path} (before=${describeDigest(
          before,
        )}, after=${describeDigest(after)})`,
      );
    }
  }
  if (postErrors.length) {
    // A rejected capture must not leave an older packet in the same slot.
    fs.rmSync(path.join(packetDirAbs, 'packet.json'), { force: true });
    return { ok: false, root: rootReal, errors: postErrors, exitCode: 1 };
  }

  const tested = preTested;

  const packet = {
    schemaVersion: SCHEMA_VERSION,
    runId: runId ?? `${check.id}-${Date.now()}`,
    createdAt: new Date().toISOString(),
    contentView: view,
    policySha256,
    check: { id: check.id, argv: [...check.argv], cwd: check.cwd },
    capture: { tool: TOOL, version: TOOL_VERSION },
    logs: {
      stdout: {
        path: toPosix(path.relative(rootReal, stdoutPath)),
        sha256: sha256Buffer(stdout),
        bytes: stdout.length,
      },
      stderr: {
        path: toPosix(path.relative(rootReal, stderrPath)),
        sha256: sha256Buffer(stderr),
        bytes: stderr.length,
      },
    },
    outcome: { exitCode, signal },
    tested,
    required: policy.coverage.requiredCheckIds.includes(check.id),
  };
  const packetPath = path.join(packetDirAbs, 'packet.json');
  writeJsonFile(packetPath, packet);
  if (!quiet) {
    process.stdout.write(
      `evidence:capture ${check.id}: exit=${exitCode} signal=${signal ?? 'none'} packet=${toPosix(
        path.relative(rootReal, packetPath),
      )}\n`,
    );
  }
  return { ok: exitCode === 0, root: rootReal, packet, packetPath, exitCode, errors: [] };
}

function toPosix(value) {
  return value.split(path.sep).join('/');
}

function runCheckCi({ root, policyPath }) {
  const loaded = loadPolicy({ root, policyPath });
  if (!loaded.ok) return { ...loaded, exitCode: 1 };
  const { rootReal, policy, policySha256 } = loaded;
  const tempRoot = path.join(rootReal, 'scripts/evidence/.ci-tmp');
  const errors = [];
  const accepted = [];
  try {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    fs.mkdirSync(tempRoot, { recursive: true });
    for (const checkId of policy.coverage.requiredCheckIds) {
      const outDir = path.join(tempRoot, checkId);
      const captured = runCapture({
        root: rootReal,
        policyPath: loaded.policyPath,
        checkId,
        view: 'ci-tree',
        outDir,
        runId: `ci-${checkId}-${Date.now()}`,
        quiet: true,
      });
      if (!captured.ok) {
        errors.push(`check:ci capture failed for "${checkId}": exit ${captured.exitCode}`);
        for (const error of captured.errors ?? []) errors.push(`check:ci ${checkId}: ${error}`);
        continue;
      }
      const packetErrors = validatePacket({
        rootReal,
        policy,
        policySha256,
        packet: captured.packet,
        expectedView: 'ci-tree',
      });
      if (packetErrors.length) {
        for (const error of packetErrors) errors.push(`check:ci ${checkId}: ${error}`);
      } else {
        accepted.push({ checkId, packet: toPosix(path.relative(rootReal, captured.packetPath)) });
      }
    }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
  return {
    ok: errors.length === 0,
    root: rootReal,
    accepted,
    errors,
    exitCode: errors.length ? 1 : 0,
  };
}

function parseArgs(argv) {
  const out = { _: [], flags: {} };
  const args = argv.filter((arg) => arg !== '--');
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = args[index + 1];
      if (next === undefined || next.startsWith('--')) {
        out.flags[key] = true;
      } else {
        out.flags[key] = next;
        index += 1;
      }
    } else {
      out._.push(arg);
    }
  }
  return out;
}

function printResult(result, label) {
  if (result.errors.length) {
    for (const error of result.errors) process.stderr.write(`REJECT ${error}\n`);
    process.stderr.write(`evidence:${label} FAILED: ${result.errors.length} error(s)\n`);
    return 1;
  }
  for (const accepted of result.accepted ?? []) {
    process.stdout.write(
      `ACCEPT ${accepted.checkId} ${accepted.relativePacket ?? accepted.packet}\n`,
    );
  }
  process.stdout.write(`evidence:${label} OK: ${(result.accepted ?? []).length} packet(s)\n`);
  return 0;
}

function usage() {
  process.stderr.write(
    [
      'usage:',
      '  node scripts/evidence/evidence.mjs check [--root DIR] [--policy FILE]',
      '  node scripts/evidence/evidence.mjs capture --check-id ID [--root DIR] [--policy FILE] [--view VIEW]',
      '  node scripts/evidence/evidence.mjs check:ci [--root DIR] [--policy FILE]',
      '  node scripts/evidence/evidence.mjs schema',
      '',
    ].join('\n'),
  );
}

function main() {
  const [command, ...rest] = process.argv.slice(2);
  const parsed = parseArgs(rest);
  const root = parsed.flags.root ?? process.cwd();
  const policyPath = parsed.flags.policy ?? DEFAULT_POLICY;
  if (command === 'schema') {
    process.stdout.write(`${JSON.stringify(schemaDocument(), null, 2)}\n`);
    return 0;
  }
  if (command === 'check') {
    return printResult(runCheck({ root, policyPath }), 'check');
  }
  if (command === 'check:ci') {
    return printResult(runCheckCi({ root, policyPath }), 'check:ci');
  }
  if (command === 'capture') {
    if (!parsed.flags['check-id'] || parsed.flags['check-id'] === true) {
      usage();
      return 2;
    }
    const captured = runCapture({
      root,
      policyPath,
      checkId: parsed.flags['check-id'],
      view: parsed.flags.view ?? 'working-tree',
    });
    if (captured.errors.length) {
      for (const error of captured.errors) process.stderr.write(`REJECT ${error}\n`);
      return captured.exitCode ?? 1;
    }
    return captured.exitCode;
  }
  usage();
  return 2;
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  try {
    process.exitCode = main();
  } catch (error) {
    if (error instanceof EvidenceError) {
      process.stderr.write(`REJECT ${error.message}\n`);
      process.exitCode = 1;
    } else {
      process.stderr.write(`REJECT unexpected error: ${error.stack ?? error.message}\n`);
      process.exitCode = 1;
    }
  }
}

export {
  EvidenceError,
  canonicalize,
  hashFile,
  loadPolicy,
  main,
  parseArgs,
  policyDigest,
  resolveContained,
  runCapture,
  runCheck,
  runCheckCi,
  sha256Buffer,
  validatePacket,
  validateShape,
};

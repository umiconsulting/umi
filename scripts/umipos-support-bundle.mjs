#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { redactSupportValue } from './lib/support-redaction.mjs';

const output = path.resolve(process.argv[2] || `artifacts/support/umipos-${Date.now()}.json`);
const baseUrl = process.env.PUBLIC_API_URL;
const manifestPath = process.env.RELEASE_MANIFEST;
if (!baseUrl || !manifestPath) throw new Error('PUBLIC_API_URL and RELEASE_MANIFEST are required.');

const readJson = async (url) => {
  const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`Support endpoint failed with HTTP ${response.status}.`);
  return response.json();
};
const composeArgs = [
  'compose',
  '--env-file',
  process.env.PILOT_ENV_FILE || 'deploy/pilot/pilot.env',
  '-f',
  'deploy/pilot/compose.yml',
  'ps',
  '--format',
  'json',
];
let services = [];
try {
  services = JSON.parse(execFileSync('docker', composeArgs, { encoding: 'utf8' }) || '[]');
} catch {
  services = [{ state: 'unavailable' }];
}
const bundle = redactSupportValue({
  schemaVersion: 1,
  createdAt: new Date().toISOString(),
  releaseManifest: JSON.parse(await readFile(manifestPath, 'utf8')),
  release: await readJson(`${baseUrl}/health/release`),
  health: await readJson(`${baseUrl}/health/ready`),
  services,
});
await mkdir(path.dirname(output), { recursive: true, mode: 0o750 });
await writeFile(output, `${JSON.stringify(bundle, null, 2)}\n`, { mode: 0o640 });
process.stdout.write(`${output}\n`);

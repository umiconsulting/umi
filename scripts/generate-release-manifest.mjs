#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateReleaseManifest } from './lib/release-manifest.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const required = [
  'RELEASE_VERSION',
  'RELEASE_GIT_COMMIT',
  'RELEASE_BUILD_TIMESTAMP',
  'UMI_ENVIRONMENT',
  'CONTRACT_VERSION',
  'CONFIG_SCHEMA_VERSION',
  'EXPECTED_SCHEMA_VERSION',
  'MINIMUM_POS_VERSION',
  'MINIMUM_DASHBOARD_VERSION',
];
for (const key of required) {
  if (!process.env[key]) throw new Error(`${key} is required.`);
}
const outputDirectory = process.argv[2];
const posArtifact = process.argv[3];
if (!outputDirectory || !posArtifact) {
  throw new Error('Usage: generate-release-manifest.mjs OUTPUT_DIRECTORY POS_ARTIFACT');
}
const result = await generateReleaseManifest({
  root,
  outputDirectory: path.resolve(outputDirectory),
  posArtifact: path.resolve(posArtifact),
  values: Object.fromEntries(required.map((key) => [key, process.env[key]])),
});
process.stdout.write(`${result.jsonPath}\n${result.summaryPath}\n`);

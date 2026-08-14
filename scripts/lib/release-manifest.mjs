import { createHash } from 'node:crypto';
import { readFile, readdir, stat, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

export async function sha256File(file) {
  const hash = createHash('sha256');
  hash.update(await readFile(file));
  return hash.digest('hex');
}

export async function migrationDigest(root) {
  const directory = path.join(root, 'docs/migration/build-v3');
  const files = (await readdir(directory)).filter((file) => file.endsWith('.sql')).sort();
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(file);
    hash.update('\0');
    hash.update(await readFile(path.join(directory, file)));
    hash.update('\0');
  }
  return { sha256: hash.digest('hex'), files };
}

export async function generateReleaseManifest({ root, outputDirectory, posArtifact, values }) {
  const artifactStat = await stat(posArtifact);
  if (!artifactStat.isFile() || artifactStat.size === 0) throw new Error('POS artifact is empty.');
  const migrations = await migrationDigest(root);
  const apiImage = `umipos-api:${values.RELEASE_VERSION}`;
  const dashboardImage = `umipos-dashboard:${values.RELEASE_VERSION}`;
  const inspect = (image) =>
    execFileSync('docker', ['image', 'inspect', '--format', '{{.Id}}', image], {
      encoding: 'utf8',
    }).trim();
  const kdsTree = execFileSync('git', ['rev-parse', `${values.RELEASE_GIT_COMMIT}:apps/umi-kds`], {
    cwd: root,
    encoding: 'utf8',
  }).trim();

  const manifest = {
    schemaVersion: 1,
    releaseVersion: values.RELEASE_VERSION,
    gitCommit: values.RELEASE_GIT_COMMIT,
    buildTimestamp: values.RELEASE_BUILD_TIMESTAMP,
    environment: values.UMI_ENVIRONMENT,
    contractVersion: values.CONTRACT_VERSION,
    configurationSchemaVersion: values.CONFIG_SCHEMA_VERSION,
    releaseNotes: 'docs/deployment/UMIPOS_RELEASE_PROCESS.md',
    migration: {
      from: 'build-v3-00',
      to: values.EXPECTED_SCHEMA_VERSION,
      sha256: migrations.sha256,
      files: migrations.files,
      rollback: 'forward-only',
    },
    artifacts: {
      api: { reference: apiImage, digest: inspect(apiImage) },
      worker: { reference: apiImage, digest: inspect(apiImage) },
      dashboard: { reference: dashboardImage, digest: inspect(dashboardImage) },
      posLinux: {
        file: path.basename(posArtifact),
        bytes: artifactStat.size,
        sha256: await sha256File(posArtifact),
      },
      kds: { reference: `git-tree:${kdsTree}`, version: values.RELEASE_VERSION },
    },
    compatibility: {
      minimumPosVersion: values.MINIMUM_POS_VERSION,
      minimumDashboardVersion: values.MINIMUM_DASHBOARD_VERSION,
      contractVersion: values.CONTRACT_VERSION,
      schemaVersion: values.EXPECTED_SCHEMA_VERSION,
    },
  };

  await mkdir(outputDirectory, { recursive: true, mode: 0o750 });
  const jsonPath = path.join(outputDirectory, 'release-manifest.json');
  const summaryPath = path.join(outputDirectory, 'release-manifest.md');
  await writeFile(jsonPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o640 });
  await writeFile(
    summaryPath,
    `# UmiPOS pilot release ${manifest.releaseVersion}\n\n` +
      `- Commit: \`${manifest.gitCommit}\`\n` +
      `- Environment: \`${manifest.environment}\`\n` +
      `- Contract: \`${manifest.contractVersion}\`\n` +
      `- Schema: \`${manifest.migration.to}\`\n` +
      `- API image: \`${manifest.artifacts.api.digest}\`\n` +
      `- Dashboard image: \`${manifest.artifacts.dashboard.digest}\`\n` +
      `- POS SHA-256: \`${manifest.artifacts.posLinux.sha256}\`\n`,
    { mode: 0o640 },
  );
  return { manifest, jsonPath, summaryPath };
}

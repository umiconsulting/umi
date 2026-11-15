import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

test('deployment uses the image commit even when the release branch has advanced', () => {
  const directory = mkdtempSync(join(tmpdir(), 'umi-deploy-release-'));
  try {
    const upstream = join(directory, 'upstream');
    const checkout = join(directory, 'checkout');
    const binaries = join(directory, 'bin');
    mkdirSync(upstream);
    mkdirSync(binaries);
    const git = (...args) =>
      execFileSync('git', args, {
        cwd: upstream,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim();
    git('init', '-b', 'staging');
    git('config', 'user.name', 'CI fixture');
    git('config', 'user.email', 'ci@umi.invalid');
    mkdirSync(join(upstream, 'apps/umi-api'), { recursive: true });
    writeFileSync(join(upstream, '.gitignore'), '.env\n');
    const compose = join(upstream, 'apps/umi-api/docker-compose.yml');
    writeFileSync(compose, '# release A\n');
    git('add', '.');
    git('commit', '-m', 'Release A');
    const release = git('rev-parse', 'HEAD');
    writeFileSync(compose, '# release B\n');
    git('commit', '-am', 'Release B');
    execFileSync('git', ['clone', '--quiet', upstream, checkout]);
    // Docker is the external deployment boundary. Git and the deploy script are real.
    writeFileSync(join(binaries, 'docker'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    execFileSync('bash', [resolve('apps/umi-api/deploy/deploy.sh'), `sha-${release}`], {
      env: {
        ...process.env,
        PATH: `${binaries}:${process.env.PATH}`,
        UMI_REPO_DIR: checkout,
        UMI_DEPLOY_BRANCH: 'staging',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const deployed = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: checkout,
      encoding: 'utf8',
    }).trim();
    assert.equal(deployed, release, 'deployment files and image must use the same commit');
    assert.equal(
      readFileSync(join(checkout, 'apps/umi-api/docker-compose.yml'), 'utf8'),
      '# release A\n',
    );
    assert.match(
      readFileSync(join(checkout, 'apps/umi-api/.env'), 'utf8'),
      new RegExp(`^UMI_API_TAG=sha-${release}$`, 'm'),
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

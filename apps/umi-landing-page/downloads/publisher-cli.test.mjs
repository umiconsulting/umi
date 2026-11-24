import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import base from '../src/data/umipos-release.json' with { type: 'json' };
import { sha256 } from './release-policy.mjs';

const apk = process.env.TEST_RELEASE_APK;
const root = dirname(fileURLToPath(import.meta.url));
// Only this test child rewrites HTTP transport. Real policy, APK tools and CLI orchestration run.
// Fake pnpm/gh never call external services or receive production credentials.
test(
  'real publisher CLI verifies APKs, promotes in order, and performs an identical retry without deployment',
  { skip: !apk, timeout: 30000 },
  async () => {
    const dir = mkdtempSync(join(tmpdir(), 'umipos-cli-test-'));
    const bytes = readFileSync(apk);
    assert.equal(sha256(bytes), base.sha256);
    const state = join(dir, 'live.json'),
      log = join(dir, 'deployments.jsonl');
    writeFileSync(state, JSON.stringify(base));
    const server = createServer((request, response) => {
      if (request.url === '/latest.json') {
        response.setHeader('Content-Type', 'application/json');
        response.end(readFileSync(state));
      } else if (request.url.endsWith('.apk')) response.end(bytes);
      else {
        response.statusCode = 404;
        response.end();
      }
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    const hook = join(dir, 'http-fixture.mjs');
    writeFileSync(
      hook,
      `const original=globalThis.fetch; globalThis.fetch=(url,options)=>original('http://127.0.0.1:${port}'+new URL(url).pathname,options);`,
    );
    mkdirSync(join(dir, 'bin'));
    writeFileSync(
      join(dir, 'bin', 'pnpm'),
      `#!/usr/bin/env node
const fs=require('node:fs');const args=process.argv.slice(2);const branch=args[args.indexOf('--branch')+1];
fs.appendFileSync(process.env.TEST_DEPLOY_LOG,JSON.stringify(args)+'\\n');
if(branch==='main')fs.copyFileSync('dist/latest.json',process.env.TEST_LIVE_STATE);
console.log('Deployment complete! https://'+(branch==='main'?'5678abcd':'1234abcd')+'.umi-pos-downloads.pages.dev');
`,
      { mode: 0o755 },
    );
    const manifest = join(dir, 'release.json'),
      approval = join(dir, 'acceptance.json');
    writeFileSync(manifest, JSON.stringify(base));
    writeFileSync(
      approval,
      JSON.stringify({
        schemaVersion: 1,
        verdict: 'PASS',
        reviewedBy: 'umi-verifier',
        evidenceUrl: 'https://github.com/umiconsulting/umi/pull/296',
        apkSha256: base.sha256,
        sourceCommit: base.sourceCommit,
        contractVersion: base.contractVersion,
        apiOrigin: base.apiOrigin,
        checks: {
          androidEmulator: 'PASS',
          kdsDelivery: 'PASS',
          paymentRecovery: 'PASS',
          productionCompatibility: 'PASS',
        },
      }),
    );
    async function publish() {
      const child = spawn(
        process.execPath,
        ['--import', hook, join(root, 'publish-release.mjs'), apk, manifest, approval],
        {
          cwd: root,
          env: {
            ...process.env,
            PATH: `${join(dir, 'bin')}:${process.env.PATH}`,
            RELEASE_TAG: `umipos-android-${base.versionCode}`,
            RELEASE_COMMIT: base.sourceCommit,
            TEST_LIVE_STATE: state,
            TEST_DEPLOY_LOG: log,
          },
        },
      );
      let output = '';
      child.stdout.on('data', (data) => (output += data));
      child.stderr.on('data', (data) => (output += data));
      const timeout = setTimeout(() => child.kill('SIGKILL'), 20000);
      const code = await new Promise((resolve, reject) => {
        child.on('error', reject);
        child.on('close', resolve);
      });
      clearTimeout(timeout);
      assert.equal(code, 0, output);
      return output;
    }
    try {
      await publish();
      const deployments = readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse);
      assert.deepEqual(
        deployments.map((args) => args[args.indexOf('--branch') + 1]),
        [`release-${base.versionCode}`, 'main'],
      );
      assert.equal(
        JSON.parse(readFileSync(state, 'utf8')).downloadOrigin,
        'https://1234abcd.umi-pos-downloads.pages.dev',
      );
      assert.match(await publish(), /"unchanged":true/);
      assert.equal(readFileSync(log, 'utf8').trim().split('\n').length, 2);
    } finally {
      await new Promise((resolve) => server.close(resolve));
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

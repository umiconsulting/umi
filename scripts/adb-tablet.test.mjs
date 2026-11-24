import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_PACKAGE,
  DEFAULT_SIGNER_SHA256,
  assertStagingTargetSafe,
  buildVerifyReplaySql,
  createRunner,
  extractWifiIp,
  loadEndpointsStore,
  normalizeEndpoint,
  parseAdbDevices,
  parseCliArgs,
  parseDumpsysBattery,
  parseDumpsysPackage,
  parseReplayApiLogs,
  sha256Buffer,
  validateStagingManifest,
} from './adb-tablet.mjs';

test('parseAdbDevices classifies usb, network, and emulator transports', () => {
  const sample = `List of devices attached
R52X1234567            device usb:1-2 product:gts9p model:SM_X810 device:gts9p transport_id:1
192.168.1.42:5555      device product:gts9p model:SM_X810 device:gts9p transport_id:2
emulator-5554          device product:sdk_gphone64_x86_64 model:sdk_gphone64_x86_64
R99UNAUTH              unauthorized usb:1-3
`;
  const parsed = parseAdbDevices(sample);
  assert.equal(parsed.length, 4);
  assert.equal(parsed[0].transport, 'usb');
  assert.equal(parsed[0].model, 'SM_X810');
  assert.equal(parsed[1].transport, 'network');
  assert.equal(parsed[2].transport, 'emulator');
  assert.equal(parsed[3].state, 'unauthorized');
});

test('extractWifiIp finds wlan0 IPv4 and ignores loopback/link-local', () => {
  const wlanOut = `12: wlan0: <BROADCAST,MULTICAST,UP,LOWER_UP>
    inet 169.254.1.2/16 scope link wlan0
    inet 192.168.1.44/24 brd 192.168.1.255 scope global wlan0`;
  assert.equal(extractWifiIp(wlanOut), '192.168.1.44');
  assert.equal(
    extractWifiIp('', 'default via 192.168.0.1 dev wlan0 proto dhcp src 192.168.0.105 metric 600'),
    '192.168.0.105',
  );
  assert.equal(extractWifiIp('inet 127.0.0.1/8'), null);
});

test('parseDumpsysBattery and parseDumpsysPackage extract key telemetry', () => {
  const battery = parseDumpsysBattery(`Current Battery Service state:
  AC powered: false
  USB powered: true
  Wireless powered: false
  status: 2
  level: 87`);
  assert.deepEqual(battery, { level: 87, status: 'charging', powered: true });

  const pkg = parseDumpsysPackage(
    `Packages:
  Package [${DEFAULT_PACKAGE}] (abc123):
    versionCode=341 minSdk=24 targetSdk=36
    versionName=1.0.2
    firstInstallTime=2026-11-24 01:00:00
    lastUpdateTime=2026-11-24 02:00:00`,
  );
  assert.equal(pkg.installed, true);
  assert.equal(pkg.versionCode, 341);
  assert.equal(pkg.versionName, '1.0.2');
  assert.equal(pkg.debuggable, false);
});

test('normalizeEndpoint appends default port to IPv4 and preserves host:port', () => {
  assert.equal(normalizeEndpoint('192.168.1.44'), '192.168.1.44:5555');
  assert.equal(normalizeEndpoint('192.168.1.44:41234'), '192.168.1.44:41234');
  assert.equal(normalizeEndpoint('onca-caja'), null);
});

test('validateStagingManifest enforces staging channel, staging API, and pinned signer', () => {
  const valid = {
    channel: 'staging',
    apiOrigin: 'https://api-staging.umiconsulting.co',
    packageName: DEFAULT_PACKAGE,
    signerSha256: DEFAULT_SIGNER_SHA256,
    sha256: 'a'.repeat(64),
    downloadOrigin: 'https://5b4d827b.umi-pos-downloads.pages.dev',
    objectPrefix: 'umipos/android/341',
    artifactFile: 'UmiPOS-1.0.2-staging-release-build341.apk',
    versionCode: 341,
    versionName: '1.0.2',
  };
  const checked = validateStagingManifest(valid);
  assert.equal(
    checked.downloadUrl,
    'https://5b4d827b.umi-pos-downloads.pages.dev/umipos/android/341/UmiPOS-1.0.2-staging-release-build341.apk',
  );

  assert.throws(() => validateStagingManifest({ ...valid, channel: 'production' }));
  assert.throws(() =>
    validateStagingManifest({ ...valid, apiOrigin: 'https://api.umiconsulting.co' }),
  );
  assert.throws(() => validateStagingManifest({ ...valid, signerSha256: '0'.repeat(64) }));
  assert.throws(() =>
    validateStagingManifest({ ...valid, downloadOrigin: 'https://evil.example' }),
  );
});

test('assertStagingTargetSafe blocks production containers and production DB names', () => {
  assert.doesNotThrow(() =>
    assertStagingTargetSafe({
      apiContainer: 'umi-api-test-api-1',
      pgContainer: 'umi-api-test-postgres-staging-1',
      db: 'umi_staging',
    }),
  );
  assert.throws(() =>
    assertStagingTargetSafe({
      apiContainer: 'umi-api-umi-api-1',
      pgContainer: 'umi-api-test-postgres-staging-1',
      db: 'umi_staging',
    }),
  );
  assert.throws(() =>
    assertStagingTargetSafe({
      apiContainer: 'umi-api-test-api-1',
      pgContainer: 'umi-api-test-postgres-staging-1',
      db: 'supabase_prod',
    }),
  );
});

test('parseReplayApiLogs counts replay batches, 401/429/5xx, and conflict codes', () => {
  const logs = [
    '{"msg":"offline_replay_batch","statusCode":200,"accepted":4}',
    '{"msg":"request","statusCode":401}',
    '{"msg":"request","statusCode":429}',
    '{"msg":"request","statusCode":500,"reason":"cart_mismatch"}',
    '{"msg":"503 request_failed POST /api/v1/pos/merchants/x/push-tokens","statusCode":503}',
    '{"msg":"offline_replay_batch","statusCode":200,"accepted":1}',
  ].join('\n');
  const parsed = parseReplayApiLogs(logs);
  assert.equal(parsed.replayBatchCount, 2);
  assert.equal(parsed.status401Count, 1);
  assert.equal(parsed.status429Count, 1);
  assert.equal(parsed.status4xxCount, 2);
  assert.equal(parsed.status5xxCount, 1);
  assert.equal(parsed.expectedPushToken503Count, 1);
  assert.equal(parsed.conflictKeywords.cart_mismatch, 1);
});

test('buildVerifyReplaySql validates merchant UUID and builds reconciliation SQL', () => {
  const sql = buildVerifyReplaySql({
    merchantId: 'dbfb6dd1-bf05-42cc-8f60-2035c1b6647b',
    windowHours: 12,
  });
  assert.match(sql, /merchant\.pos_committed_sale/);
  assert.match(sql, /server_repriced_totals IS NOT NULL/);
  assert.match(sql, /merchant\.cash_ledger_entry/);
  assert.match(sql, /merchant\.offline_provisional_mapping/);
  assert.match(sql, /runtime\.idempotency_key/);
  assert.match(sql, /dbfb6dd1-bf05-42cc-8f60-2035c1b6647b/);
  assert.throws(() => buildVerifyReplaySql({ merchantId: 'not-a-uuid; DROP TABLE x' }));
});

test('usbToWifi enables tcpip:5555, connects over Wi-Fi, and persists fleet_doctor-compatible state', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'umi-adb-test-'));
  const statePath = join(dir, 'umi-adb-endpoints.json');
  let connectedWifi = false;

  const runner = createRunner({
    exec: (bin, args) => {
      assert.equal(bin, 'adb');
      const cmd = args.join(' ');
      if (cmd === 'devices -l') {
        return connectedWifi
          ? 'List of devices attached\nUSB123 device model:SM_X210\n192.168.1.55:5555 device model:SM_X210\n'
          : 'List of devices attached\nUSB123 device model:SM_X210\n';
      }
      if (cmd === '-s USB123 shell getprop ro.product.model') return 'SM-X210\n';
      if (cmd === '-s USB123 shell ip -f inet addr show wlan0') {
        return '    inet 192.168.1.55/24 brd 192.168.1.255 scope global wlan0\n';
      }
      if (cmd === '-s USB123 shell ip route') return '';
      if (cmd === '-s USB123 tcpip 5555') return 'restarting in TCP mode port: 5555\n';
      if (cmd === 'connect 192.168.1.55:5555') {
        connectedWifi = true;
        return 'connected to 192.168.1.55:5555\n';
      }
      throw new Error(`Unexpected command: ${cmd}`);
    },
  });

  try {
    const res = await runner.usbToWifi({ alias: 'tab-staging', statePath, sleepMs: 0 });
    assert.equal(res.ok, true);
    assert.equal(res.endpoint, '192.168.1.55:5555');

    const saved = loadEndpointsStore(statePath);
    assert.equal(saved['tab-staging'].endpoint, '192.168.1.55:5555');
    assert.equal(saved['192.168.1.55'].endpoint, '192.168.1.55:5555');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('install staging verifies SHA-256 and installed versionCode', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'umi-adb-install-'));
  const cacheDir = join(dir, 'cache');
  const statePath = join(dir, 'endpoints.json');
  const fakeApk = Buffer.from('PK\x03\x04fake-staging-apk-bytes');
  const expectedSha = sha256Buffer(fakeApk);
  const manifest = {
    channel: 'staging',
    apiOrigin: 'https://api-staging.umiconsulting.co',
    packageName: DEFAULT_PACKAGE,
    signerSha256: DEFAULT_SIGNER_SHA256,
    sha256: expectedSha,
    downloadOrigin: 'https://5b4d827b.umi-pos-downloads.pages.dev',
    objectPrefix: 'umipos/android/341',
    artifactFile: 'UmiPOS-1.0.2-staging-release-build341.apk',
    versionCode: 341,
    versionName: '1.0.2',
  };

  const runner = createRunner({
    exec: (_bin, args) => {
      const cmd = args.join(' ');
      if (cmd === 'devices -l') return 'List of devices attached\n192.168.1.55:5555 device\n';
      if (args.includes('install')) return 'Performing Streamed Install\nSuccess\n';
      if (cmd.includes('dumpsys package')) {
        return `Package [${DEFAULT_PACKAGE}]\n  versionCode=341\n  versionName=1.0.2\n`;
      }
      throw new Error(`Unexpected command: ${cmd}`);
    },
    fetchImpl: async (url) => {
      if (url.endsWith('/latest.json')) {
        return { ok: true, status: 200, json: async () => manifest };
      }
      return { ok: true, status: 200, arrayBuffer: async () => fakeApk };
    },
  });

  try {
    const res = await runner.install({ source: 'staging', cacheDir, statePath });
    assert.equal(res.ok, true);
    assert.equal(res.sha256, expectedSha);
    assert.equal(res.installed.versionCode, 341);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('shot validates PNG signature and writes file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'umi-adb-shot-'));
  const outPath = join(dir, 'evidence.png');
  const validPng = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(128, 0x11),
  ]);

  const runner = createRunner({
    exec: (_bin, args) => {
      if (args.join(' ') === 'devices -l') {
        return 'List of devices attached\n192.168.1.55:5555 device\n';
      }
      if (args.includes('screencap')) return validPng;
      throw new Error(`Unexpected command: ${args.join(' ')}`);
    },
  });

  try {
    const res = runner.shot({ outPath, statePath: join(dir, 'none.json') });
    assert.equal(res.ok, true);
    assert.equal(res.bytes, validPng.length);
    assert.deepEqual(readFileSync(outPath), validPng);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('verifyReplay combines staging API logs and umi_staging SQL reconciliation', () => {
  const dir = mkdtempSync(join(tmpdir(), 'umi-adb-verify-'));
  const outPath = join(dir, 'verify.json');
  const dbJson = JSON.stringify({
    windowHours: 24,
    merchantId: null,
    committedSales: {
      count: 3,
      repricedCount: 0,
      totalDivergenceMinorUnits: 0,
      duplicateCartIds: 0,
    },
    cashLedger: [{ entry_type: 'cash_sale', entry_count: 3, total_amount_minor_units: 18500 }],
    provisionalMappings: {
      count: 2,
      distinctProvisionals: 2,
      distinctOfficialSales: 2,
      duplicateProvisionals: 0,
      duplicateOfficialSales: 0,
    },
    replayCommands: [{ command_type: 'pos.checkout.cash', command_count: 2 }],
    replayConflicts: { total: 0, unresolved: 0, byClassification: {} },
    idempotencyKeys: { count: 4, scopes: { 'pos.checkout': 3 } },
  });

  const runner = createRunner({
    exec: (bin, args) => {
      assert.equal(bin, 'ssh');
      const remote = args[args.length - 1];
      if (remote.includes('docker logs')) {
        return '{"msg":"offline_replay_batch","statusCode":200,"accepted":2}\n';
      }
      if (remote.includes('psql')) {
        return `${dbJson}\n`;
      }
      throw new Error(`Unexpected ssh command: ${remote}`);
    },
  });

  try {
    const report = runner.verifyReplay({ since: '30m', outPath });
    assert.equal(report.ok, true);
    assert.equal(report.apiLogs.replayBatchCount, 1);
    assert.equal(report.db.committedSales.count, 3);
    assert.equal(JSON.parse(readFileSync(outPath, 'utf8')).ok, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('parseCliArgs handles pnpm -- separator and flags cleanly', () => {
  const parsed = parseCliArgs([
    '--',
    'verify-replay',
    '--since',
    '45m',
    '--merchant',
    'dbfb6dd1-bf05-42cc-8f60-2035c1b6647b',
    '--json',
  ]);
  assert.equal(parsed.command, 'verify-replay');
  assert.equal(parsed.flags.since, '45m');
  assert.equal(parsed.flags.json, true);

  // Local APK checksum validation test with temp file
  const dir = mkdtempSync(join(tmpdir(), 'umi-adb-local-'));
  const apk = join(dir, 'sample.apk');
  writeFileSync(apk, 'test-apk');
  try {
    assert.equal(sha256Buffer(readFileSync(apk)).length, 64);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

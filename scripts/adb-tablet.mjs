#!/usr/bin/env node
/**
 * Deterministic ADB wireless & staging-certification helper for UmiPOS Android tablets.
 *
 * Compatible with ~/.local/state/umi-adb-endpoints.json used by fleet_doctor.py.
 *
 * Subcommands:
 *   usb-to-wifi   Detect USB tablet, enable tcpip:5555, discover Wi-Fi IP, connect & save endpoint
 *   pair          Pair over Android Wireless Debugging (`adb pair <host:port> <code>`)
 *   connect       Connect (or auto-reconnect) by alias, IP, or IP:port (defaults to :5555)
 *   status        Report model, Android version, battery, Wi-Fi IP, and installed UmiPOS build
 *   install       Install a local APK or `staging` (downloads + verifies SHA-256 against latest.json)
 *   shot          Capture PNG screenshot via `adb exec-out screencap -p`
 *   logs          Dump filtered Flutter/UmiPOS/offline logcat lines
 *   force-stop    Force-stop co.umiconsulting.umi_pos.estacion
 *   net-off       Disable connectivity on tablet (`--mode airplane|wifi|data`, default `airplane`)
 *   net-on        Restore connectivity on tablet (`--mode airplane|wifi|data`, default `airplane`)
 *   verify-replay Cross-check staging VPS `docker logs umi-api-test-api-1` and `umi_staging` SQL
 */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const DEFAULT_PACKAGE = 'co.umiconsulting.umi_pos.estacion';
export const DEFAULT_PORT = 5555;
export const DEFAULT_STAGING_MANIFEST_URL =
  'https://staging.umi-pos-downloads.pages.dev/latest.json';
export const DEFAULT_SIGNER_SHA256 =
  '14975f2c374e03b155ab363e17d4a79d4ab32b888ab381bedc3264934cb5c051';
export const DEFAULT_SSH_HOST = 'juan@2.24.204.15';
export const DEFAULT_STAGING_API_CONTAINER = 'umi-api-test-api-1';
export const DEFAULT_STAGING_PG_CONTAINER = 'umi-api-test-postgres-staging-1';
export const DEFAULT_STAGING_DB = 'umi_staging';

export const DEFAULT_LOG_FILTER =
  /flutter|umi_pos|Offline|Replay|Connectivity|CartController|Checkout|Recovery|AndroidRuntime|FATAL EXCEPTION|E\/SQLite/i;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const IPV4_RE = /^\d{1,3}(?:\.\d{1,3}){3}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SINCE_RE = /^\d+[smhd]$|^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?$/;
const PROD_CONTAINER_RE = /umi-api-umi-/i;
const PROD_DB_RE = /prod|supabase/i;

export function defaultStatePath(env = process.env) {
  return (
    env.UMI_ADB_STATE_PATH ||
    join(env.XDG_STATE_HOME || join(homedir(), '.local', 'state'), 'umi-adb-endpoints.json')
  );
}

export function defaultCacheDir(env = process.env) {
  return (
    env.UMI_ADB_CACHE_DIR ||
    join(env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'umi-adb', 'apks')
  );
}

export function sha256Buffer(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

export function sanitizeAlias(value) {
  return (
    String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'tablet'
  );
}

export function normalizeEndpoint(rawTarget, port = DEFAULT_PORT) {
  const target = String(rawTarget || '').trim();
  if (!target) return null;
  if (target.includes(':')) {
    return target;
  }
  if (IPV4_RE.test(target)) {
    return `${target}:${port}`;
  }
  return null;
}

export function parseAdbDevices(output) {
  const devices = [];
  for (const rawLine of String(output || '').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('List of devices') || line.startsWith('*')) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 2) continue;
    const serial = parts[0];
    const state = parts[1];
    const meta = {};
    for (const token of parts.slice(2)) {
      const idx = token.indexOf(':');
      if (idx > 0) {
        meta[token.slice(0, idx)] = token.slice(idx + 1);
      }
    }
    const isEmulator = serial.startsWith('emulator-');
    const isNetwork = serial.includes(':') || serial.includes('._adb-tls-');
    devices.push({
      serial,
      state,
      transport: isEmulator ? 'emulator' : isNetwork ? 'network' : 'usb',
      model: meta.model || null,
      device: meta.device || null,
      product: meta.product || null,
    });
  }
  return devices;
}

export function extractWifiIp(ipAddrOutput, ipRouteOutput = '') {
  for (const text of [ipAddrOutput, ipRouteOutput]) {
    const inetMatches = [...String(text || '').matchAll(/\binet\s+(\d{1,3}(?:\.\d{1,3}){3})\b/g)];
    for (const match of inetMatches) {
      const ip = match[1];
      if (!ip.startsWith('127.') && !ip.startsWith('169.254.')) return ip;
    }
    const srcMatches = [...String(text || '').matchAll(/\bsrc\s+(\d{1,3}(?:\.\d{1,3}){3})\b/g)];
    for (const match of srcMatches) {
      const ip = match[1];
      if (!ip.startsWith('127.') && !ip.startsWith('169.254.')) return ip;
    }
  }
  return null;
}

export function parseDumpsysBattery(output) {
  const text = String(output || '');
  const levelMatch = text.match(/^\s*level:\s*(\d+)/m);
  const statusMatch = text.match(/^\s*status:\s*(\d+)/m);
  const acMatch = text.match(/^\s*AC powered:\s*(true|false)/m);
  const usbMatch = text.match(/^\s*USB powered:\s*(true|false)/m);
  const wirelessMatch = text.match(/^\s*Wireless powered:\s*(true|false)/m);
  const statusMap = {
    1: 'unknown',
    2: 'charging',
    3: 'discharging',
    4: 'not_charging',
    5: 'full',
  };
  const statusCode = statusMatch ? Number(statusMatch[1]) : null;
  return {
    level: levelMatch ? Number(levelMatch[1]) : null,
    status: statusCode ? statusMap[statusCode] || String(statusCode) : null,
    powered: Boolean(
      acMatch?.[1] === 'true' || usbMatch?.[1] === 'true' || wirelessMatch?.[1] === 'true',
    ),
  };
}

export function parseDumpsysPackage(output, pkg = DEFAULT_PACKAGE) {
  const text = String(output || '');
  if (!text.includes(`Package [${pkg}]`)) {
    return { installed: false, packageName: pkg };
  }
  const versionCode = text.match(/versionCode=(\d+)/);
  const versionName = text.match(/versionName=([^\s]+)/);
  const firstInstall = text.match(/firstInstallTime=([^\r\n]+)/);
  const lastUpdate = text.match(/lastUpdateTime=([^\r\n]+)/);
  return {
    installed: true,
    packageName: pkg,
    versionCode: versionCode ? Number(versionCode[1]) : null,
    versionName: versionName ? versionName[1] : null,
    debuggable: text.includes('DEBUGGABLE'),
    firstInstallTime: firstInstall ? firstInstall[1].trim() : null,
    lastUpdateTime: lastUpdate ? lastUpdate[1].trim() : null,
  };
}

export function loadEndpointsStore(statePath = defaultStatePath()) {
  if (!existsSync(statePath)) return {};
  try {
    const parsed = JSON.parse(readFileSync(statePath, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function saveEndpointsStore(store, statePath = defaultStatePath()) {
  mkdirSync(dirname(statePath), { recursive: true, mode: 0o700 });
  writeFileSync(statePath, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
}

export function resolveSavedEndpoint(store, aliasOrIp) {
  if (!aliasOrIp || !store || typeof store !== 'object') return null;
  const entry = store[aliasOrIp];
  if (typeof entry === 'string') return entry;
  if (entry && typeof entry === 'object' && typeof entry.endpoint === 'string') {
    return entry.endpoint;
  }
  return null;
}

export function validateStagingManifest(manifest, expectedPackage = DEFAULT_PACKAGE) {
  const issues = [];
  if (!manifest || typeof manifest !== 'object') {
    throw new Error('Staging manifest is not a JSON object.');
  }
  if (manifest.channel !== 'staging') {
    issues.push(`channel=${String(manifest.channel)} (expected staging)`);
  }
  if (manifest.apiOrigin !== 'https://api-staging.umiconsulting.co') {
    issues.push(`apiOrigin=${String(manifest.apiOrigin)} (expected staging API)`);
  }
  if (manifest.packageName !== expectedPackage) {
    issues.push(`packageName=${String(manifest.packageName)} (expected ${expectedPackage})`);
  }
  if (manifest.signerSha256 !== DEFAULT_SIGNER_SHA256) {
    issues.push('signerSha256 does not match pinned UmiPOS release signer');
  }
  if (!/^[a-f0-9]{64}$/i.test(String(manifest.sha256 || ''))) {
    issues.push('invalid sha256 in staging manifest');
  }
  if (
    typeof manifest.downloadOrigin !== 'string' ||
    !/^https:\/\/(?:[a-z0-9-]+\.)?umi-pos-downloads\.pages\.dev$/.test(manifest.downloadOrigin)
  ) {
    issues.push(`untrusted downloadOrigin: ${String(manifest.downloadOrigin)}`);
  }
  if (
    typeof manifest.objectPrefix !== 'string' ||
    !manifest.objectPrefix.startsWith('umipos/android/') ||
    manifest.objectPrefix.includes('..')
  ) {
    issues.push(`invalid objectPrefix: ${String(manifest.objectPrefix)}`);
  }
  if (
    typeof manifest.artifactFile !== 'string' ||
    !/^UmiPOS-[\w.-]+-staging-release-build\d+\.apk$/.test(manifest.artifactFile)
  ) {
    issues.push(`invalid staging artifactFile: ${String(manifest.artifactFile)}`);
  }
  if (issues.length > 0) {
    throw new Error(`Invalid staging manifest: ${issues.join('; ')}`);
  }
  return {
    ...manifest,
    downloadUrl: `${manifest.downloadOrigin}/${manifest.objectPrefix}/${manifest.artifactFile}`,
  };
}

export function parseReplayApiLogs(logText) {
  const lines = String(logText || '')
    .split('\n')
    .filter((line) => line.trim().length > 0);

  const summary = {
    totalLinesInspected: lines.length,
    replayBatchCount: 0,
    replayBatchSamples: [],
    status401Count: 0,
    status429Count: 0,
    status4xxCount: 0,
    status5xxCount: 0,
    expectedPushToken503Count: 0,
    conflictKeywords: {
      cart_mismatch: 0,
      fingerprint_mismatch: 0,
      aggregate_version_conflict: 0,
      table_unavailable: 0,
      offline_limit_exceeded: 0,
    },
    errorSamples: [],
  };

  for (const line of lines) {
    if (line.includes('offline_replay_batch')) {
      summary.replayBatchCount += 1;
      if (summary.replayBatchSamples.length < 20) {
        summary.replayBatchSamples.push(line.slice(0, 400));
      }
    }

    const statusMatch =
      line.match(/"statusCode"\s*:\s*(\d{3})/) ||
      line.match(/\bstatus(?:Code)?[=:]\s*(\d{3})\b/) ||
      line.match(/\s(4\d\d|5\d\d)\s+\d+(?:\.\d+)?\s*ms\b/);
    if (statusMatch) {
      const code = Number(statusMatch[1]);
      if (code === 401) summary.status401Count += 1;
      if (code === 429) summary.status429Count += 1;
      if (code >= 400 && code < 500) summary.status4xxCount += 1;
      if (code >= 500) {
        if (code === 503 && line.includes('/push-tokens')) {
          summary.expectedPushToken503Count += 1;
        } else {
          summary.status5xxCount += 1;
          if (summary.errorSamples.length < 15) summary.errorSamples.push(line.slice(0, 350));
        }
      }
    }

    for (const key of Object.keys(summary.conflictKeywords)) {
      if (line.includes(key)) {
        summary.conflictKeywords[key] += 1;
      }
    }
  }

  return summary;
}

export function buildVerifyReplaySql({ merchantId = null, windowHours = 24 } = {}) {
  const safeHours = Math.max(1, Math.min(720, Math.floor(Number(windowHours) || 24)));
  if (merchantId !== null && merchantId !== '' && !UUID_RE.test(merchantId)) {
    throw new Error(`Invalid merchant UUID: ${merchantId}`);
  }
  const merchantClause = merchantId ? `AND merchant_id = '${merchantId}'::uuid` : '';

  return `
SELECT json_build_object(
  'windowHours', ${safeHours},
  'merchantId', ${merchantId ? `'${merchantId}'` : 'NULL'},
  'committedSales', (
    SELECT json_build_object(
      'count', COUNT(*),
      'repricedCount', COUNT(*) FILTER (WHERE server_repriced_totals IS NOT NULL),
      'totalDivergenceMinorUnits', COALESCE(SUM(divergence_minor_units), 0),
      'duplicateCartIds', (
        SELECT COUNT(*) FROM (
          SELECT cart_id FROM merchant.pos_committed_sale
          WHERE committed_at >= NOW() - INTERVAL '${safeHours} hours' ${merchantClause}
          GROUP BY cart_id HAVING COUNT(*) > 1
        ) dup_cart
      )
    )
    FROM merchant.pos_committed_sale
    WHERE committed_at >= NOW() - INTERVAL '${safeHours} hours' ${merchantClause}
  ),
  'cashLedger', (
    SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
    FROM (
      SELECT entry_type,
             COUNT(*) AS entry_count,
             COALESCE(SUM(amount_minor_units), 0) AS total_amount_minor_units,
             COALESCE(SUM(cash_received_minor_units), 0) AS total_received_minor_units,
             COALESCE(SUM(change_given_minor_units), 0) AS total_change_minor_units
      FROM merchant.cash_ledger_entry
      WHERE occurred_at >= NOW() - INTERVAL '${safeHours} hours' ${merchantClause}
      GROUP BY entry_type
      ORDER BY entry_type
    ) t
  ),
  'provisionalMappings', (
    SELECT json_build_object(
      'count', COUNT(*),
      'distinctProvisionals', COUNT(DISTINCT provisional_id),
      'distinctOfficialSales', COUNT(DISTINCT official_sale_id),
      'duplicateProvisionals', COUNT(*) - COUNT(DISTINCT provisional_id),
      'duplicateOfficialSales', COUNT(*) - COUNT(DISTINCT official_sale_id)
    )
    FROM merchant.offline_provisional_mapping
    WHERE mapped_at >= NOW() - INTERVAL '${safeHours} hours' ${merchantClause}
  ),
  'replayCommands', (
    SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
    FROM (
      SELECT command_type, COUNT(*) AS command_count
      FROM merchant.offline_replay_command
      WHERE accepted_at >= NOW() - INTERVAL '${safeHours} hours' ${merchantClause}
      GROUP BY command_type
      ORDER BY command_type
    ) t
  ),
  'replayConflicts', (
    SELECT json_build_object(
      'total', COUNT(*),
      'unresolved', COUNT(*) FILTER (WHERE resolution_state <> 'resolved' AND resolution_state <> 'acknowledged'),
      'byClassification', COALESCE((
        SELECT json_object_agg(classification, cnt)
        FROM (
          SELECT classification, COUNT(*) AS cnt
          FROM merchant.offline_replay_conflict
          WHERE last_observed_at >= NOW() - INTERVAL '${safeHours} hours' ${merchantClause}
          GROUP BY classification
        ) c
      ), '{}'::json)
    )
    FROM merchant.offline_replay_conflict
    WHERE last_observed_at >= NOW() - INTERVAL '${safeHours} hours' ${merchantClause}
  ),
  'idempotencyKeys', (
    SELECT json_build_object(
      'count', COUNT(*),
      'scopes', COALESCE((
        SELECT json_object_agg(scope, cnt)
        FROM (
          SELECT scope, COUNT(*) AS cnt
          FROM runtime.idempotency_key
          WHERE created_at >= NOW() - INTERVAL '${safeHours} hours' ${merchantClause}
          GROUP BY scope
        ) s
      ), '{}'::json)
    )
    FROM runtime.idempotency_key
    WHERE created_at >= NOW() - INTERVAL '${safeHours} hours' ${merchantClause}
  )
)::text;
`.trim();
}

export function assertStagingTargetSafe({ apiContainer, pgContainer, db }) {
  if (PROD_CONTAINER_RE.test(String(apiContainer || ''))) {
    throw new Error(`Refusing to target production API container: ${apiContainer}`);
  }
  if (PROD_CONTAINER_RE.test(String(pgContainer || ''))) {
    throw new Error(`Refusing to target production DB container: ${pgContainer}`);
  }
  if (PROD_DB_RE.test(String(db || ''))) {
    throw new Error(`Refusing to target production database: ${db}`);
  }
}

export function createRunner({ exec = execFileSync, fetchImpl = globalThis.fetch } = {}) {
  function runText(bin, args, options = {}) {
    const out = exec(bin, args, {
      encoding: 'utf8',
      timeout: options.timeout ?? 25_000,
      maxBuffer: options.maxBuffer ?? 32 * 1024 * 1024,
      input: options.input,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return String(out ?? '');
  }

  function runBuffer(bin, args, options = {}) {
    return exec(bin, args, {
      timeout: options.timeout ?? 25_000,
      maxBuffer: options.maxBuffer ?? 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  }

  function adbDevices() {
    return parseAdbDevices(runText('adb', ['devices', '-l']));
  }

  function resolveSerial(target, { statePath = defaultStatePath(), port = DEFAULT_PORT } = {}) {
    const store = loadEndpointsStore(statePath);
    const devices = adbDevices();
    const online = devices.filter((d) => d.state === 'device');

    if (target) {
      const saved = resolveSavedEndpoint(store, target);
      const candidate = saved || normalizeEndpoint(target, port) || target;
      const direct = online.find((d) => d.serial === candidate || d.serial === target);
      if (direct) return direct.serial;
      if (candidate.includes(':')) {
        runText('adb', ['connect', candidate], { timeout: 15_000 });
        const after = adbDevices().find((d) => d.serial === candidate && d.state === 'device');
        if (after) return after.serial;
      }
      throw new Error(`Device not connected or unreachable via ADB: ${target} (${candidate})`);
    }

    if (online.length === 1) {
      return online[0].serial;
    }

    if (online.length > 1) {
      const nonEmu = online.filter((d) => d.transport !== 'emulator');
      if (nonEmu.length === 1) return nonEmu[0].serial;
      throw new Error(
        `Multiple ADB devices connected (${online.map((d) => d.serial).join(', ')}). Specify a target alias or serial.`,
      );
    }

    // Try auto-reconnecting saved endpoints from ~/.local/state/umi-adb-endpoints.json
    const tried = new Set();
    for (const val of Object.values(store)) {
      const ep = typeof val === 'string' ? val : val?.endpoint;
      if (!ep || tried.has(ep)) continue;
      tried.add(ep);
      try {
        runText('adb', ['connect', ep], { timeout: 10_000 });
        const after = adbDevices().find((d) => d.serial === ep && d.state === 'device');
        if (after) return after.serial;
      } catch {
        // continue trying saved endpoints
      }
    }

    throw new Error(
      'No ADB device connected. Connect tablet via USB and run `pnpm adb:tablet usb-to-wifi`, or pass `<ip:port>`.',
    );
  }

  function adbShell(serial, shellArgs, timeout = 20_000) {
    return runText('adb', ['-s', serial, 'shell', ...shellArgs], { timeout }).trim();
  }

  function getWifiIp(serial) {
    const wlan = (() => {
      try {
        return adbShell(serial, ['ip', '-f', 'inet', 'addr', 'show', 'wlan0']);
      } catch {
        return '';
      }
    })();
    const route = (() => {
      try {
        return adbShell(serial, ['ip', 'route']);
      } catch {
        return '';
      }
    })();
    return extractWifiIp(wlan, route);
  }

  async function usbToWifi({
    alias = null,
    port = DEFAULT_PORT,
    serial = null,
    statePath = defaultStatePath(),
    sleepMs = 1500,
  } = {}) {
    const devices = adbDevices();
    const usbCandidates = devices.filter(
      (d) => d.state === 'device' && d.transport === 'usb' && (!serial || d.serial === serial),
    );
    if (usbCandidates.length === 0) {
      const unauthorized = devices.filter((d) => d.state === 'unauthorized');
      if (unauthorized.length > 0) {
        throw new Error(
          `USB device is unauthorized (${unauthorized[0].serial}). Accept the RSA debugging prompt on the tablet screen.`,
        );
      }
      throw new Error(
        'No USB Android tablet detected in `adb devices`. Connect the tablet via USB with USB debugging enabled.',
      );
    }
    const usb = usbCandidates[0];
    const model = adbShell(usb.serial, ['getprop', 'ro.product.model']) || usb.model || 'android';
    const ip = getWifiIp(usb.serial);
    if (!ip) {
      throw new Error(
        `Could not detect Wi-Fi IPv4 address on ${usb.serial} (${model}). Ensure the tablet is connected to Wi-Fi.`,
      );
    }

    runText('adb', ['-s', usb.serial, 'tcpip', String(port)], { timeout: 15_000 });
    if (sleepMs > 0) {
      await new Promise((r) => setTimeout(r, sleepMs));
    }
    const endpoint = `${ip}:${port}`;
    const connectOut = runText('adb', ['connect', endpoint], { timeout: 15_000 }).trim();
    const connected = adbDevices().find((d) => d.serial === endpoint && d.state === 'device');
    if (!connected) {
      throw new Error(
        `ADB tcpip enabled, but wireless connect to ${endpoint} failed: ${connectOut}`,
      );
    }

    const store = loadEndpointsStore(statePath);
    const key = sanitizeAlias(alias || model);
    const record = {
      endpoint,
      ip,
      port,
      usbSerial: usb.serial,
      model,
      updatedAt: new Date().toISOString(),
    };
    store[key] = record;
    store[ip] = record;
    saveEndpointsStore(store, statePath);

    return {
      ok: true,
      alias: key,
      usbSerial: usb.serial,
      model,
      ip,
      port,
      endpoint,
      statePath,
      connectOutput: connectOut,
    };
  }

  function pair({ endpoint, code }) {
    if (!endpoint || !code) {
      throw new Error('Usage: adb-tablet pair <host:port> <pairing-code>');
    }
    const out = runText('adb', ['pair', endpoint, code], { timeout: 20_000 }).trim();
    const ok = /successfully paired/i.test(out);
    return { ok, endpoint, output: out };
  }

  function connect({
    target = null,
    port = DEFAULT_PORT,
    alias = null,
    statePath = defaultStatePath(),
  } = {}) {
    const store = loadEndpointsStore(statePath);
    const resolved =
      resolveSavedEndpoint(store, target) ||
      normalizeEndpoint(target, port) ||
      (target ? target : null);
    if (!resolved) {
      const serial = resolveSerial(null, { statePath, port });
      return { ok: true, endpoint: serial, reconnected: true };
    }
    const output = runText('adb', ['connect', resolved], { timeout: 15_000 }).trim();
    const match = adbDevices().find((d) => d.serial === resolved && d.state === 'device');
    if (!match) {
      throw new Error(`Could not connect to ${resolved}: ${output}`);
    }
    if (alias) {
      const ip = resolved.split(':')[0];
      const record = {
        endpoint: resolved,
        ip,
        port: Number(resolved.split(':')[1] || port),
        updatedAt: new Date().toISOString(),
      };
      store[sanitizeAlias(alias)] = record;
      if (IPV4_RE.test(ip)) store[ip] = record;
      saveEndpointsStore(store, statePath);
    }
    return { ok: true, endpoint: resolved, output };
  }

  function status({ target = null, pkg = DEFAULT_PACKAGE, statePath = defaultStatePath() } = {}) {
    const serial = resolveSerial(target, { statePath });
    const model = adbShell(serial, ['getprop', 'ro.product.model']);
    const manufacturer = adbShell(serial, ['getprop', 'ro.product.manufacturer']);
    const androidRelease = adbShell(serial, ['getprop', 'ro.build.version.release']);
    const androidSdk = Number(adbShell(serial, ['getprop', 'ro.build.version.sdk'])) || null;
    const battery = parseDumpsysBattery(adbShell(serial, ['dumpsys', 'battery']));
    const ip = getWifiIp(serial);
    const app = parseDumpsysPackage(adbShell(serial, ['dumpsys', 'package', pkg]), pkg);
    const pid = (() => {
      try {
        return adbShell(serial, ['pidof', pkg]) || null;
      } catch {
        return null;
      }
    })();

    return {
      ok: true,
      serial,
      manufacturer,
      model,
      androidRelease,
      androidSdk,
      wifiIp: ip,
      battery,
      app: { ...app, runningPid: pid },
    };
  }

  async function install({
    source,
    target = null,
    expectedSha256 = null,
    pkg = DEFAULT_PACKAGE,
    allowDowngrade = false,
    manifestUrl = process.env.UMIPOS_STAGING_MANIFEST_URL || DEFAULT_STAGING_MANIFEST_URL,
    cacheDir = defaultCacheDir(),
    statePath = defaultStatePath(),
  } = {}) {
    if (!source) {
      throw new Error('Usage: adb-tablet install <apk-path|staging> [target]');
    }
    const serial = resolveSerial(target, { statePath });

    let apkPath;
    let shaExpected = expectedSha256 ? expectedSha256.toLowerCase() : null;
    let expectedVersionCode = null;
    let manifestMeta = null;

    if (source === 'staging') {
      const resp = await fetchImpl(manifestUrl, { cache: 'no-store' });
      if (!resp.ok) {
        throw new Error(`Failed to fetch staging manifest (${resp.status}): ${manifestUrl}`);
      }
      const rawManifest = await resp.json();
      manifestMeta = validateStagingManifest(rawManifest, pkg);
      shaExpected = manifestMeta.sha256.toLowerCase();
      expectedVersionCode = manifestMeta.versionCode;

      mkdirSync(cacheDir, { recursive: true });
      apkPath = join(cacheDir, manifestMeta.artifactFile);

      let needsDownload = true;
      if (existsSync(apkPath)) {
        const cachedHash = sha256Buffer(readFileSync(apkPath));
        if (cachedHash === shaExpected) {
          needsDownload = false;
        }
      }
      if (needsDownload) {
        const apkResp = await fetchImpl(manifestMeta.downloadUrl);
        if (!apkResp.ok) {
          throw new Error(
            `Failed to download staging APK (${apkResp.status}): ${manifestMeta.downloadUrl}`,
          );
        }
        const bytes = Buffer.from(await apkResp.arrayBuffer());
        const actualHash = sha256Buffer(bytes);
        if (actualHash !== shaExpected) {
          throw new Error(
            `Downloaded staging APK SHA-256 mismatch: expected ${shaExpected}, got ${actualHash}`,
          );
        }
        writeFileSync(apkPath, bytes);
      }
    } else {
      apkPath = resolve(source);
      if (!existsSync(apkPath)) {
        throw new Error(`APK file not found: ${apkPath}`);
      }
    }

    const actualSha256 = sha256Buffer(readFileSync(apkPath));
    if (shaExpected && actualSha256 !== shaExpected) {
      throw new Error(`APK SHA-256 mismatch: expected ${shaExpected}, got ${actualSha256}`);
    }

    const installArgs = ['-s', serial, 'install', '-r'];
    if (allowDowngrade) installArgs.push('-d');
    installArgs.push(apkPath);

    const installOut = runText('adb', installArgs, { timeout: 120_000 }).trim();
    if (!/Success/i.test(installOut)) {
      throw new Error(`adb install failed on ${serial}: ${installOut}`);
    }

    const app = parseDumpsysPackage(adbShell(serial, ['dumpsys', 'package', pkg]), pkg);
    if (!app.installed) {
      throw new Error(`Package ${pkg} not found on ${serial} after install.`);
    }
    if (expectedVersionCode !== null && app.versionCode !== expectedVersionCode) {
      throw new Error(
        `Installed versionCode ${app.versionCode} does not match expected ${expectedVersionCode}.`,
      );
    }

    return {
      ok: true,
      serial,
      source,
      apkPath,
      sha256: actualSha256,
      manifest: manifestMeta
        ? { versionCode: manifestMeta.versionCode, versionName: manifestMeta.versionName }
        : null,
      installed: app,
    };
  }

  function shot({ outPath, target = null, statePath = defaultStatePath() } = {}) {
    if (!outPath) {
      throw new Error('Usage: adb-tablet shot <output.png> [target]');
    }
    const serial = resolveSerial(target, { statePath });
    const png = runBuffer('adb', ['-s', serial, 'exec-out', 'screencap', '-p'], {
      timeout: 20_000,
    });
    if (!Buffer.isBuffer(png) || png.length < 64 || !png.subarray(0, 8).equals(PNG_SIGNATURE)) {
      throw new Error(`Invalid PNG screencap received from ${serial} (${png?.length ?? 0} bytes).`);
    }
    const resolvedOut = resolve(outPath);
    mkdirSync(dirname(resolvedOut), { recursive: true });
    writeFileSync(resolvedOut, png);
    return { ok: true, serial, path: resolvedOut, bytes: png.length };
  }

  function logs({
    target = null,
    lines = 600,
    clear = false,
    outPath = null,
    filterPattern = null,
    statePath = defaultStatePath(),
  } = {}) {
    const serial = resolveSerial(target, { statePath });
    if (clear) {
      runText('adb', ['-s', serial, 'logcat', '-c'], { timeout: 10_000 });
      return { ok: true, serial, cleared: true, matchedLines: 0, lines: [] };
    }
    const raw = runText(
      'adb',
      [
        '-s',
        serial,
        'logcat',
        '-d',
        '-v',
        'time',
        '-t',
        String(Math.max(50, Number(lines) || 600)),
      ],
      { timeout: 20_000 },
    );
    const regex = filterPattern ? new RegExp(filterPattern, 'i') : DEFAULT_LOG_FILTER;
    const matched = raw.split('\n').filter((line) => line.trim().length > 0 && regex.test(line));
    if (outPath) {
      const resolvedOut = resolve(outPath);
      mkdirSync(dirname(resolvedOut), { recursive: true });
      writeFileSync(resolvedOut, `${matched.join('\n')}\n`, 'utf8');
    }
    return {
      ok: true,
      serial,
      matchedLines: matched.length,
      fatalCount: matched.filter((l) => /FATAL EXCEPTION/i.test(l)).length,
      outPath: outPath ? resolve(outPath) : null,
      lines: matched,
    };
  }

  function forceStop({
    target = null,
    pkg = DEFAULT_PACKAGE,
    statePath = defaultStatePath(),
  } = {}) {
    const serial = resolveSerial(target, { statePath });
    adbShell(serial, ['am', 'force-stop', pkg]);
    const pid = (() => {
      try {
        return adbShell(serial, ['pidof', pkg]) || null;
      } catch {
        return null;
      }
    })();
    return { ok: pid === null, serial, packageName: pkg, remainingPid: pid };
  }

  function setNetwork({
    enabled,
    mode = 'airplane',
    target = null,
    statePath = defaultStatePath(),
  } = {}) {
    const serial = resolveSerial(target, { statePath });
    const actions = [];
    if (mode === 'airplane') {
      const cmdVerb = enabled ? 'disable' : 'enable';
      try {
        adbShell(serial, ['cmd', 'connectivity', 'airplane-mode', cmdVerb]);
        actions.push(`cmd connectivity airplane-mode ${cmdVerb}`);
      } catch {
        const flag = enabled ? '0' : '1';
        adbShell(serial, ['settings', 'put', 'global', 'airplane_mode_on', flag]);
        adbShell(serial, [
          'am',
          'broadcast',
          '-a',
          'android.intent.action.AIRPLANE_MODE',
          '--ez',
          'state',
          enabled ? 'false' : 'true',
        ]);
        actions.push(`settings airplane_mode_on=${flag}`);
      }
    } else if (mode === 'wifi') {
      const verb = enabled ? 'enable' : 'disable';
      adbShell(serial, ['svc', 'wifi', verb]);
      actions.push(`svc wifi ${verb}`);
    } else if (mode === 'data') {
      const verb = enabled ? 'enable' : 'disable';
      adbShell(serial, ['svc', 'data', verb]);
      actions.push(`svc data ${verb}`);
    } else {
      throw new Error(`Unsupported network mode: ${mode} (expected airplane, wifi, or data)`);
    }
    return { ok: true, serial, mode, enabled, actions };
  }

  function verifyReplay({
    since = '30m',
    windowHours = 24,
    merchantId = null,
    sshHost = DEFAULT_SSH_HOST,
    apiContainer = DEFAULT_STAGING_API_CONTAINER,
    pgContainer = DEFAULT_STAGING_PG_CONTAINER,
    db = DEFAULT_STAGING_DB,
    outPath = null,
  } = {}) {
    assertStagingTargetSafe({ apiContainer, pgContainer, db });
    if (!SINCE_RE.test(String(since))) {
      throw new Error(`Invalid --since value: ${since}`);
    }

    const logOutput = runText(
      'ssh',
      [
        '-o',
        'BatchMode=yes',
        '-o',
        'ConnectTimeout=10',
        sshHost,
        `docker logs --since ${since} ${apiContainer} 2>&1`,
      ],
      { timeout: 30_000 },
    );
    const apiLogs = parseReplayApiLogs(logOutput);

    const sql = buildVerifyReplaySql({ merchantId, windowHours });
    const sqlOut = runText(
      'ssh',
      [
        '-o',
        'BatchMode=yes',
        '-o',
        'ConnectTimeout=10',
        sshHost,
        `docker exec -i ${pgContainer} psql -U postgres -d ${db} -v ON_ERROR_STOP=1 -t -A`,
      ],
      { timeout: 30_000, input: `${sql}\n` },
    ).trim();

    const lastJsonLine = sqlOut
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('{'))
      .pop();
    if (!lastJsonLine) {
      throw new Error(`Could not parse JSON reconciliation result from ${db}: ${sqlOut}`);
    }
    const dbSummary = JSON.parse(lastJsonLine);

    const issues = [];
    if (apiLogs.status5xxCount > 0) {
      issues.push(`Detected ${apiLogs.status5xxCount} HTTP 5xx responses in ${apiContainer}`);
    }
    if (apiLogs.status401Count >= 10) {
      issues.push(`Possible 401 storm: ${apiLogs.status401Count} responses`);
    }
    if (apiLogs.status429Count > 0) {
      issues.push(`Detected ${apiLogs.status429Count} HTTP 429 rate-limit responses`);
    }
    if (dbSummary.committedSales.duplicateCartIds > 0) {
      issues.push(
        `Duplicate committed sales per cart: ${dbSummary.committedSales.duplicateCartIds}`,
      );
    }
    if (dbSummary.provisionalMappings.duplicateProvisionals > 0) {
      issues.push(
        `Duplicate provisional IDs mapped: ${dbSummary.provisionalMappings.duplicateProvisionals}`,
      );
    }
    if (dbSummary.provisionalMappings.duplicateOfficialSales > 0) {
      issues.push(
        `Duplicate official sales mapped: ${dbSummary.provisionalMappings.duplicateOfficialSales}`,
      );
    }
    if (dbSummary.replayConflicts.unresolved > 0) {
      issues.push(`Unresolved replay conflicts: ${dbSummary.replayConflicts.unresolved}`);
    }

    const report = {
      ok: issues.length === 0,
      checkedAtUtc: new Date().toISOString(),
      target: { sshHost, apiContainer, pgContainer, db, since, windowHours, merchantId },
      apiLogs,
      db: dbSummary,
      issues,
    };

    if (outPath) {
      const resolvedOut = resolve(outPath);
      mkdirSync(dirname(resolvedOut), { recursive: true });
      writeFileSync(resolvedOut, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    }

    return report;
  }

  return {
    usbToWifi,
    pair,
    connect,
    status,
    install,
    shot,
    logs,
    forceStop,
    setNetwork,
    verifyReplay,
  };
}

export function parseCliArgs(argv) {
  const positionals = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') continue;
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i += 1;
      }
    } else if (arg === '-h') {
      flags.help = true;
    } else {
      positionals.push(arg);
    }
  }
  return { command: positionals[0] || null, positionals: positionals.slice(1), flags };
}

function printUsage() {
  console.log(`Usage: node scripts/adb-tablet.mjs <subcommand> [args] [options]

Subcommands:
  usb-to-wifi [--alias NAME] [--port 5555] [--serial USB_SERIAL] [--json]
  pair <host:port> <code> [--json]
  connect [alias|ip[:port]] [--port 5555] [--alias NAME] [--json]
  status [target] [--package PKG] [--json]
  install <apk|staging> [target] [--sha256 HEX] [--allow-downgrade] [--json]
  shot <out.png> [target] [--json]
  logs [target] [--lines 600] [--clear] [--out FILE] [--filter REGEX] [--json]
  force-stop [target] [--package PKG] [--json]
  net-off [target] [--mode airplane|wifi|data] [--json]
  net-on [target] [--mode airplane|wifi|data] [--json]
  verify-replay [--since 30m] [--window-hours 24] [--merchant UUID] [--out FILE] [--json]`);
}

async function main() {
  const { command, positionals, flags } = parseCliArgs(process.argv.slice(2));
  if (!command || flags.help) {
    printUsage();
    return 0;
  }

  const runner = createRunner();
  let result;

  switch (command) {
    case 'usb-to-wifi':
      result = await runner.usbToWifi({
        alias: typeof flags.alias === 'string' ? flags.alias : null,
        port: flags.port ? Number(flags.port) : DEFAULT_PORT,
        serial: typeof flags.serial === 'string' ? flags.serial : null,
      });
      break;
    case 'pair':
      result = runner.pair({ endpoint: positionals[0], code: positionals[1] });
      break;
    case 'connect':
      result = runner.connect({
        target: positionals[0] || null,
        port: flags.port ? Number(flags.port) : DEFAULT_PORT,
        alias: typeof flags.alias === 'string' ? flags.alias : null,
      });
      break;
    case 'status':
      result = runner.status({
        target: positionals[0] || null,
        pkg: typeof flags.package === 'string' ? flags.package : DEFAULT_PACKAGE,
      });
      break;
    case 'install':
      result = await runner.install({
        source: positionals[0],
        target: positionals[1] || null,
        expectedSha256: typeof flags.sha256 === 'string' ? flags.sha256 : null,
        pkg: typeof flags.package === 'string' ? flags.package : DEFAULT_PACKAGE,
        allowDowngrade: Boolean(flags['allow-downgrade']),
      });
      break;
    case 'shot':
      result = runner.shot({
        outPath: positionals[0],
        target: positionals[1] || null,
      });
      break;
    case 'logs':
      result = runner.logs({
        target: positionals[0] || null,
        lines: flags.lines ? Number(flags.lines) : 600,
        clear: Boolean(flags.clear),
        outPath: typeof flags.out === 'string' ? flags.out : null,
        filterPattern: typeof flags.filter === 'string' ? flags.filter : null,
      });
      break;
    case 'force-stop':
      result = runner.forceStop({
        target: positionals[0] || null,
        pkg: typeof flags.package === 'string' ? flags.package : DEFAULT_PACKAGE,
      });
      break;
    case 'net-off':
      result = runner.setNetwork({
        enabled: false,
        mode: typeof flags.mode === 'string' ? flags.mode : 'airplane',
        target: positionals[0] || null,
      });
      break;
    case 'net-on':
      result = runner.setNetwork({
        enabled: true,
        mode: typeof flags.mode === 'string' ? flags.mode : 'airplane',
        target: positionals[0] || null,
      });
      break;
    case 'verify-replay':
      result = runner.verifyReplay({
        since: typeof flags.since === 'string' ? flags.since : '30m',
        windowHours: flags['window-hours'] ? Number(flags['window-hours']) : 24,
        merchantId: typeof flags.merchant === 'string' ? flags.merchant : null,
        sshHost: typeof flags['ssh-host'] === 'string' ? flags['ssh-host'] : DEFAULT_SSH_HOST,
        apiContainer:
          typeof flags['api-container'] === 'string'
            ? flags['api-container']
            : DEFAULT_STAGING_API_CONTAINER,
        pgContainer:
          typeof flags['pg-container'] === 'string'
            ? flags['pg-container']
            : DEFAULT_STAGING_PG_CONTAINER,
        db: typeof flags.db === 'string' ? flags.db : DEFAULT_STAGING_DB,
        outPath: typeof flags.out === 'string' ? flags.out : null,
      });
      break;
    default:
      throw new Error(`Unknown subcommand: ${command}`);
  }

  if (flags.json || command !== 'logs') {
    console.log(JSON.stringify(result, null, 2));
  } else {
    for (const line of result.lines) console.log(line);
  }
  return result.ok === false ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    });
}

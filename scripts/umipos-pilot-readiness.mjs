#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const composeFile = join(root, 'deploy/pilot/compose.yml');
const envFile = resolve(process.env.UMIPOS_PILOT_ENV_FILE || join(root, 'deploy/pilot/pilot.env'));
const profileFile = resolve(
  process.env.UMIPOS_BUSINESS_PROFILE || join(root, 'config/umipos-pilot-business-profile.json'),
);
const jsonOutput = process.argv.includes('--json');

export function validateProfile(profile) {
  const errors = [];
  const warnings = [];
  const serialized = JSON.stringify(profile);
  const forbidden =
    /(password|secret|token|cookie|csrf|pin|credential|gift.?card.?code|encryption.?key)/i;
  const walk = (value, path = '') => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      const next = path ? `${path}.${key}` : key;
      if (forbidden.test(key)) errors.push(`${next}: campo secreto prohibido`);
      walk(child, next);
    }
  };
  walk(profile);
  if (profile.schemaVersion !== 1) errors.push('schemaVersion debe ser 1');
  if (!['template', 'pilot'].includes(profile.profileType)) errors.push('profileType inválido');
  if (profile.environment !== 'pilot') errors.push('environment debe ser pilot');
  if (!profile.merchant?.timezone || !profile.merchant?.currency || !profile.merchant?.locale)
    errors.push('faltan datos del comercio');
  if (!Array.isArray(profile.locations) || profile.locations.length === 0)
    errors.push('falta una ubicación');
  if (!profile.policies || !profile.featureFlags) errors.push('faltan políticas o feature flags');
  if (/CHANGE_ME/i.test(serialized)) errors.push('el perfil contiene CHANGE_ME');
  if (profile.profileType === 'pilot' && serialized.includes('OWNER_DECISION_REQUIRED'))
    errors.push('faltan decisiones del Owner');
  if (profile.profileType === 'template')
    warnings.push('plantilla: completa las decisiones del Owner antes del alta');
  return { errors, warnings };
}

function parseEnv(path) {
  if (!existsSync(path)) return {};
  return Object.fromEntries(
    readFileSync(path, 'utf8')
      .split(/\r?\n/)
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => {
        const index = line.indexOf('=');
        return [line.slice(0, index), line.slice(index + 1).replace(/^['"]|['"]$/g, '')];
      }),
  );
}

function run(file, args, options = {}) {
  return execFileSync(file, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  }).trim();
}

function latestBackupAgeHours(environment) {
  const dir = join(root, 'backups', environment);
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir, { recursive: true }).filter((name) =>
    String(name).endsWith('.dump'),
  );
  if (!files.length) return null;
  const newest = Math.max(...files.map((name) => statSync(join(dir, name)).mtimeMs));
  return (Date.now() - newest) / 3_600_000;
}

export function readinessStatus(checks) {
  if (checks.some((check) => check.level === 'fail')) return 'NOT READY';
  if (checks.some((check) => check.level === 'warn')) return 'READY WITH WARNINGS';
  return 'READY';
}

async function main() {
  const checks = [];
  const add = (name, level, detail) => checks.push({ name, level, detail });
  let profile;
  try {
    profile = JSON.parse(readFileSync(profileFile, 'utf8'));
  } catch {
    add('business-profile', 'fail', 'perfil ausente o JSON inválido');
  }
  if (profile) {
    const validation = validateProfile(profile);
    add(
      'business-profile',
      validation.errors.length ? 'fail' : validation.warnings.length ? 'warn' : 'pass',
      [...validation.errors, ...validation.warnings].join('; ') || 'perfil válido',
    );
  }
  const env = { ...parseEnv(envFile), ...process.env };
  add(
    'release-environment',
    env.UMI_ENVIRONMENT === 'pilot' && env.NODE_ENV === 'production' ? 'pass' : 'fail',
    'se requiere pilot/production',
  );
  const composeArgs = ['compose', '--env-file', envFile, '-f', composeFile];
  const compose = (...args) =>
    run('docker', [...composeArgs, ...args], {
      env: { ...process.env, ...env, PILOT_ENV_FILE: envFile },
    });
  try {
    compose('config', '--quiet');
    add('deployment-config', 'pass', 'Docker Compose válido');
    const services = compose('ps', '--status', 'running', '--services').split(/\s+/);
    for (const service of ['postgres', 'redis', 'umi-api', 'umi-worker', 'umi-dashboard'])
      add(
        service,
        services.includes(service) ? 'pass' : 'fail',
        services.includes(service) ? 'en ejecución' : 'sin ejecución',
      );
    try {
      const curlArgs = env.PILOT_CURL_INSECURE === 'true' ? ['-kfsS'] : ['-fsS'];
      const ready = JSON.parse(run('curl', [...curlArgs, `${env.PUBLIC_API_URL}/health/ready`]));
      add('api-health', ready.state === 'Healthy' ? 'pass' : 'fail', ready.state || 'inválido');
    } catch {
      add('api-health', 'fail', 'readiness no saludable');
    }
    try {
      add(
        'redis-health',
        compose(
          'exec',
          '-T',
          'redis',
          'sh',
          '-ec',
          'REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli ping',
        ) === 'PONG'
          ? 'pass'
          : 'fail',
        'PING',
      );
    } catch {
      add('redis-health', 'fail', 'PING falló');
    }
    const pg = (sql) =>
      compose(
        'exec',
        '-T',
        'postgres',
        'psql',
        '-U',
        'postgres',
        '-d',
        env.POSTGRES_DB,
        '-Atqc',
        sql,
      );
    const merchantId = env.SMOKE_MERCHANT_ID || '';
    const locationId = env.SMOKE_LOCATION_ID || '';
    const deviceId = env.SMOKE_DEVICE_ID || '';
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (![merchantId, locationId, deviceId].every((value) => uuid.test(value)))
      throw new Error('Las referencias de readiness deben ser UUID válidos.');
    const scoped = (table, extra = 'true') =>
      pg(`select count(*) from ${table} where merchant_id='${merchantId}'::uuid and ${extra}`) !==
      '0';
    add(
      'migrations',
      pg('select count(*) from runtime.schema_migration') !== '0' ? 'pass' : 'fail',
      'historial de migración',
    );
    const rlsTables = [
      'physical_register',
      'cash_shift_policy',
      'inventory_item',
      'inventory_policy',
      'hardware_device',
      'hardware_command',
      'kitchen_route',
      'kitchen_order',
    ];
    add(
      'rls',
      Number(
        pg(
          `select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='merchant' and c.relname=any(array[${rlsTables.map((name) => `'${name}'`).join(',')}]) and (not c.relrowsecurity or not c.relforcerowsecurity)`,
        ),
      ) === 0
        ? 'pass'
        : 'fail',
      'RLS y FORCE RLS en tablas operativas',
    );
    add(
      'merchant',
      pg(
        `select count(*) from merchant.merchant where id='${merchantId}'::uuid and status='active'`,
      ) === '1'
        ? 'pass'
        : 'fail',
      merchantId || 'sin referencia',
    );
    add(
      'location',
      scoped('merchant.location', `id='${locationId}'::uuid and status='active'`) ? 'pass' : 'fail',
      locationId || 'sin referencia',
    );
    add(
      'register',
      scoped(
        'merchant.physical_register',
        `location_id='${locationId}'::uuid and active and archived_at is null`,
      )
        ? 'pass'
        : 'fail',
      'registro activo',
    );
    add(
      'users-owner',
      Number(
        pg(
          `select count(*) from merchant.staff s join umi.role r on r.id=s.role_id where s.merchant_id='${merchantId}'::uuid and s.status='active' and r.key='owner'`,
        ),
      ) >= 1
        ? 'pass'
        : 'fail',
      'Owner activo',
    );
    add(
      'pos-device',
      scoped(
        'merchant.device',
        `id='${deviceId}'::uuid and location_id='${locationId}'::uuid and status='active'`,
      )
        ? 'pass'
        : 'fail',
      'dispositivo asignado',
    );
    add(
      'hardware',
      scoped('merchant.hardware_device', `location_id='${locationId}'::uuid and enabled`)
        ? 'pass'
        : 'fail',
      'hardware activo',
    );
    add(
      'printer',
      pg(
        `select count(*) from merchant.hardware_assignment a join merchant.hardware_device h on h.id=a.hardware_id and h.merchant_id=a.merchant_id where a.merchant_id='${merchantId}'::uuid and a.location_id='${locationId}'::uuid and a.released_at is null and a.primary_device and h.enabled and h.device_type='printer'`,
      ) === '1'
        ? 'pass'
        : 'fail',
      'impresora primaria asignada',
    );
    add(
      'scanner',
      scoped(
        'merchant.hardware_device',
        `location_id='${locationId}'::uuid and enabled and device_type='barcode_scanner'`,
      )
        ? 'pass'
        : 'warn',
      'escáner',
    );
    add(
      'kds',
      Number(
        pg(
          `select count(*) from merchant.kitchen_device_station k join merchant.station s on s.id=k.station_id and s.merchant_id=k.merchant_id where k.merchant_id='${merchantId}'::uuid and k.location_id='${locationId}'::uuid and k.active and s.status='active'`,
        ),
      ) > 0
        ? 'pass'
        : 'fail',
      'estación emparejada',
    );
    add('catalog', scoped('merchant.product', 'active') ? 'pass' : 'fail', 'catálogo activo');
    add(
      'preparation-routes',
      scoped('merchant.kitchen_route', `location_id='${locationId}'::uuid and active`)
        ? 'pass'
        : 'fail',
      'rutas activas',
    );
    add(
      'inventory',
      scoped('merchant.inventory_item') &&
        scoped('merchant.inventory_policy', `location_id='${locationId}'::uuid`)
        ? 'pass'
        : 'fail',
      'artículos y política',
    );
    add(
      'policies',
      scoped('merchant.pos_offline_policy') &&
        scoped('merchant.cash_shift_policy', `location_id='${locationId}'::uuid`)
        ? 'pass'
        : 'fail',
      'efectivo y offline',
    );
    add(
      'recovery-backlog',
      Number(
        pg(
          `select count(*) from merchant.hardware_command c where c.merchant_id='${merchantId}'::uuid and c.created_at < now()-interval '15 minutes' and not exists (select 1 from merchant.hardware_command_event e where e.merchant_id=c.merchant_id and e.command_id=c.id and e.status in ('succeeded','failed','cancelled'))`,
        ),
      ) === 0
        ? 'pass'
        : 'warn',
      'comandos antiguos',
    );
  } catch (error) {
    add(
      'runtime-inspection',
      'fail',
      String(error.stderr || error.message)
        .split('\n')[0]
        .slice(0, 180),
    );
  }
  const age = latestBackupAgeHours(env.UMI_ENVIRONMENT || 'pilot');
  add(
    'backup-freshness',
    age === null ? 'warn' : age <= 24 ? 'pass' : 'warn',
    age === null ? 'sin respaldo local' : `${age.toFixed(1)} horas`,
  );
  add('object-storage', 'warn', 'diferido por política; no es autoridad financiera');
  const status = readinessStatus(checks);
  const report = {
    schemaVersion: 1,
    status,
    environment: env.UMI_ENVIRONMENT || null,
    release: env.RELEASE_VERSION || null,
    checks,
  };
  if (jsonOutput) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`UMIPOS PILOT READINESS: ${status}`);
    for (const check of checks)
      console.log(`${check.level.toUpperCase().padEnd(4)} ${check.name}: ${check.detail}`);
  }
  process.exitCode = status === 'NOT READY' ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();

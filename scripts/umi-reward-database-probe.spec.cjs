const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

const source = readFileSync(path.join(__dirname, 'umi-reward-database-probe.cjs'), 'utf8');
const project = 'xbudknbimkgjjgohnjgp';
const secret = 'private-password-sentinel';
const validEnv = {
  DATABASE_URL_WORKER: `postgresql://postgres:${secret}@db.${project}.supabase.co:5432/postgres`,
  PGSSLROOTCERT: '-----BEGIN CERTIFICATE-----\nfixture\n-----END CERTIFICATE-----',
};
const validRow = {
  databaseMatches: true,
  readOnly: true,
  canonicalSchemas: true,
  tenantMatches: true,
  serverMajor: 17,
  serverTls: true,
  roleIsPostgres: false,
  roleIsSuperuser: false,
  roleHasBypassRls: true,
  allCanonicalTablesReadable: true,
  rewardSchemaPresent: false,
};

async function runProbe({ env = {}, row = {}, connectError, tls = {}, caError } = {}) {
  const lines = [];
  const queries = [];
  let settings;
  let connected = false;
  let ended = false;
  class Client {
    constructor(config) {
      settings = config;
      this.connection = { stream: { encrypted: true, authorized: true, ...tls } };
    }
    on() {}
    async connect() {
      connected = true;
      if (connectError) throw connectError;
    }
    async query(sql, params) {
      queries.push({ sql, params });
      return { rows: [{ ...validRow, ...row, unexpectedSecret: secret }] };
    }
    async end() {
      ended = true;
    }
  }
  const processStub = { env: { ...validEnv, ...env }, exitCode: 0 };
  const context = {
    process: processStub,
    URL,
    console: { log: (line) => lines.push(line), error: (line) => lines.push(line) },
    require: (name) => {
      if (name === 'pg') return { Client };
      if (name === 'node:fs')
        return {
          readFileSync: () => {
            if (caError) throw caError;
            return validEnv.PGSSLROOTCERT;
          },
        };
      throw new Error('Unexpected module');
    },
  };
  await vm.runInNewContext(source, context);
  const output = lines.join('\n');
  assert.equal(output.includes(secret), false, 'The output must exclude passwords and raw errors');
  return {
    output,
    result: lines.length ? JSON.parse(lines[0]) : {},
    queries,
    settings,
    connected,
    ended,
    exitCode: processStub.exitCode,
  };
}

test('reports only safe facts after a read-only transaction and connection close', async () => {
  const probe = await runProbe();
  assert.equal(probe.result.ok, true);
  assert.equal(probe.exitCode, 0);
  assert.equal(probe.ended, true);
  assert.equal(probe.settings.ssl.rejectUnauthorized, true);
  assert.match(probe.settings.options, /default_transaction_read_only=on/);
  assert.equal(probe.queries[0].sql, 'BEGIN READ ONLY');
  assert.equal(probe.queries.at(-1).sql, 'ROLLBACK');
  assert.ok(probe.queries.slice(1, -1).every(({ sql }) => /^\s*SELECT\b/.test(sql)));
  assert.equal(probe.result.unexpectedSecret, undefined);
});

for (const url of [
  `postgresql://postgres:${secret}@db.other-project.supabase.co/postgres`,
  `postgresql://postgres:${secret}@db.${project}.supabase.co/other_database`,
  `postgresql://postgres:${secret}@aws-1-us-east-2.pooler.supabase.com/postgres`,
  ...['ssl', 'sslmode', 'sslcert', 'sslkey', 'sslrootcert', 'host', 'options'].map(
    (option) => `${validEnv.DATABASE_URL_WORKER}?${option}=require`,
  ),
]) {
  test('rejects an incorrect target or a URL that can replace TLS verification', async () => {
    const probe = await runProbe({ env: { DATABASE_URL_WORKER: url } });
    assert.equal(probe.exitCode, 1);
    assert.equal(probe.connected, false);
  });
}

test('accepts the documented pooler only with the correct project username', async () => {
  const probe = await runProbe({
    env: {
      DATABASE_URL_WORKER: `postgresql://worker.${project}:${secret}@aws-1-us-east-2.pooler.supabase.com:5432/postgres`,
    },
  });
  assert.equal(probe.result.ok, true);
});

test('uses port 5432 when the URL omits the port and the environment names another port', async () => {
  const probe = await runProbe({
    env: {
      DATABASE_URL_WORKER: validEnv.DATABASE_URL_WORKER.replace(':5432/', '/'),
      PGPORT: '6543',
    },
  });
  assert.equal(probe.result.ok, true);
  assert.equal(new URL(probe.settings.connectionString).port, '5432');
});

test('rejects an absent CA before database access', async () => {
  const probe = await runProbe({ env: { PGSSLROOTCERT: '' } });
  assert.equal(probe.exitCode, 1);
  assert.equal(probe.connected, false);
});

test('suppresses a CA file error that contains a secret', async () => {
  const probe = await runProbe({
    env: { PGSSLROOTCERT: '/certs/root.crt' },
    caError: new Error(secret),
  });
  assert.equal(probe.exitCode, 1);
  assert.equal(probe.connected, false);
});

test('suppresses an authentication error that contains the connection password', async () => {
  const probe = await runProbe({ connectError: new Error(`Authentication failed: ${secret}`) });
  assert.equal(probe.result.ok, false);
  assert.equal(probe.exitCode, 1);
  assert.equal(probe.ended, true);
});

test('refuses SQL when the socket has no authenticated TLS connection', async () => {
  const probe = await runProbe({ tls: { authorized: false } });
  assert.equal(probe.exitCode, 1);
  assert.equal(probe.queries.length, 0);
  assert.equal(probe.ended, true);
});

for (const field of ['databaseMatches', 'readOnly', 'canonicalSchemas', 'tenantMatches']) {
  test(`rejects failed ${field} verification`, async () => {
    const probe = await runProbe({ row: { [field]: false } });
    assert.equal(probe.result.ok, false);
    assert.equal(probe.exitCode, 1);
    assert.equal(probe.ended, true);
  });
}

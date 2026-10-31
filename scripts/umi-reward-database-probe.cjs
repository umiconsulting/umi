'use strict';

// Stream this file to node inside the existing worker. Do not load worker.js.
(async () => {
  let client;
  let stage = 'configuration';
  try {
    const { readFileSync } = require('node:fs');
    const { Client } = require('pg');
    const project = 'xbudknbimkgjjgohnjgp';
    const url = new URL(process.env.DATABASE_URL_WORKER);
    const direct = url.hostname === `db.${project}.supabase.co`;
    const session =
      url.hostname === 'aws-1-us-east-2.pooler.supabase.com' &&
      decodeURIComponent(url.username).endsWith(`.${project}`);
    // pg parses URL parameters as connection overrides. Reject all of them.
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      (!direct && !session) ||
      url.pathname !== '/postgres' ||
      url.search ||
      url.hash ||
      (url.port && url.port !== '5432') ||
      !url.username ||
      !url.password
    ) {
      throw new Error('Target validation failed');
    }
    const caValue = process.env.PGSSLROOTCERT;
    if (!caValue) throw new Error('CA configuration absent');
    const ca = caValue.includes('BEGIN CERTIFICATE') ? caValue : readFileSync(caValue);
    // Override a driver default from PGPORT when the URL omits the port.
    url.port = '5432';
    client = new Client({
      connectionString: url.toString(),
      ssl: { ca, rejectUnauthorized: true },
      connectionTimeoutMillis: 10000,
      statement_timeout: 10000,
      query_timeout: 12000,
      options: '-c default_transaction_read_only=on -c lock_timeout=3000',
      application_name: 'umi_reward_release_readonly_probe',
    });
    let connectionError = false;
    client.on('error', () => {
      connectionError = true;
    });
    stage = 'connection';
    await client.connect();
    stage = 'tls';
    const stream = client.connection?.stream;
    if (stream?.encrypted !== true || stream?.authorized !== true) {
      throw new Error('TLS verification failed');
    }
    stage = 'query';
    await client.query('BEGIN READ ONLY');
    const { rows } = await client.query(
      `SELECT
      current_database() = 'postgres' AS "databaseMatches",
      current_setting('transaction_read_only') = 'on' AS "readOnly",
      current_setting('server_version_num')::int / 10000 AS "serverMajor",
      (SELECT count(*) = 3 FROM pg_namespace
        WHERE nspname IN ('umi','merchant','runtime')) AS "canonicalSchemas",
      EXISTS(SELECT 1 FROM merchant.merchant WHERE id = $1::uuid AND handle = $2) AS "tenantMatches",
      COALESCE((SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()),false) AS "serverTls",
      current_user = 'postgres' AS "roleIsPostgres",
      (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS "roleIsSuperuser",
      (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS "roleHasBypassRls",
      NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname IN ('umi','merchant','runtime') AND c.relkind IN ('r','p','v','m','f')
        AND NOT has_table_privilege(c.oid,'SELECT')) AS "allCanonicalTablesReadable",
      to_regclass('merchant.loyalty_reward_entitlement') IS NOT NULL AS "rewardSchemaPresent"`,
      ['a13905a2-0319-4cc1-cacf-eee47b75e309', 'elgranribera'],
    );
    stage = 'validation';
    const row = rows[0];
    const required = ['databaseMatches', 'readOnly', 'canonicalSchemas', 'tenantMatches'];
    const facts = [
      ...required,
      'serverTls',
      'roleIsPostgres',
      'roleIsSuperuser',
      'roleHasBypassRls',
      'allCanonicalTablesReadable',
      'rewardSchemaPresent',
    ];
    if (
      !row ||
      required.some((field) => row[field] !== true) ||
      facts.some((field) => typeof row[field] !== 'boolean') ||
      !Number.isInteger(row.serverMajor) ||
      row.serverMajor < 17 ||
      row.serverMajor > 99 ||
      connectionError
    ) {
      throw new Error('Database verification failed');
    }
    await client.query('ROLLBACK');
    stage = 'close';
    await client.end();
    // Use a fixed output list. Never print rows, connection strings, or errors.
    console.log(
      JSON.stringify({
        ok: true,
        project,
        clientTlsVerified: true,
        serverMajor: row.serverMajor,
        ...Object.fromEntries(facts.map((field) => [field, row[field]])),
      }),
    );
  } catch {
    if (client) {
      try {
        await client.end();
      } catch {
        /* Suppress raw driver errors. */
      }
    }
    console.log(JSON.stringify({ ok: false, stage, error: 'CHECK_FAILED' }));
    process.exitCode = 1;
  }
})();

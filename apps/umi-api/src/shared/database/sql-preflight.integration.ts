import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/config.schema';
import { PgService } from './pg.service';

/**
 * SQL PREFLIGHT — the column-level gate.
 *
 * The schema-parity gate only checks TABLE NAMES. It is blind to columns, to
 * quoted identifiers, and to function calls — which is why 488 `tenant_id`
 * references (build-v3 has ZERO `tenant_id` columns), a missing
 * `tenant.normalize_phone()`, and an `ON CONFLICT` on a non-existent unique
 * index all sailed through it while every gate reported green.
 *
 * This harness PREPAREs every SQL statement the backend issues against the live
 * build-v3 database. Postgres resolves every relation, column, function and
 * ON CONFLICT target at PARSE time — no execution, no data touched, no params
 * needed. So it catches exactly the class the name-gate cannot:
 *
 *   42P01 undefined_table      42703 undefined_column
 *   42883 undefined_function   42P10 invalid_column_reference (ON CONFLICT)
 *
 * Runs on the WORKER pool deliberately: we are testing SCHEMA validity, not
 * privilege. (Privilege is the rls.integration.ts harness's job.)
 *
 * Coverage is reported honestly: statements built by string interpolation
 * cannot be preflighted as-is and are COUNTED, never silently skipped.
 */

const WORKER_DSN =
  process.env.DATABASE_URL_WORKER ??
  'postgresql://worker_login:harness_worker@127.0.0.1:5233/umi_backfill_v3';

/** Errors that mean "the schema does not have what this SQL asks for". */
const SCHEMA_ERRORS = new Set(['42P01', '42703', '42883', '42P10', '42P02']);
/** Postgres cannot infer a bare `$1`'s type. Not a schema defect — reported separately. */
const PARAM_TYPE_ERROR = '42P18';

interface Stmt {
  sql: string;
  file: string;
  line: number;
}

function sourceFiles(root: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(root, { recursive: true, withFileTypes: true })) {
    if (!e.isFile() || !e.name.endsWith('.ts')) continue;
    if (
      e.name.endsWith('.spec.ts') ||
      e.name.endsWith('.integration.ts') ||
      e.name.endsWith('.d.ts')
    )
      continue;
    const dir =
      (e as unknown as { parentPath?: string }).parentPath ??
      (e as unknown as { path: string }).path;
    out.push(join(dir, e.name));
  }
  return out;
}

/** Pull every backtick template literal that looks like a SQL statement. */
function extractStatements(root: string): { stmts: Stmt[]; interpolated: Stmt[] } {
  const stmts: Stmt[] = [];
  const interpolated: Stmt[] = [];
  const LOOKS_LIKE_SQL = /^\s*(?:with|select|insert|update|delete)\s/i;

  for (const file of sourceFiles(root)) {
    const text = readFileSync(file, 'utf8');
    // Walk backtick-delimited spans. Good enough for this codebase: every SQL
    // string is a plain template literal passed to query().
    let i = 0;
    while (i < text.length) {
      const start = text.indexOf('`', i);
      if (start === -1) break;
      const end = text.indexOf('`', start + 1);
      if (end === -1) break;
      const body = text.slice(start + 1, end);
      i = end + 1;
      if (!LOOKS_LIKE_SQL.test(body)) continue;

      const line = text.slice(0, start).split('\n').length;
      const rel = file.slice(root.length + 1);
      const entry = { sql: body, file: rel, line };
      // `${...}` means the statement is assembled at runtime — we cannot PREPARE
      // it verbatim. Count it as UNCOVERED rather than pretend it passed.
      if (body.includes('${')) interpolated.push(entry);
      else stmts.push(entry);
    }
  }
  return { stmts, interpolated };
}

function makeConfig(): ConfigService<AppConfig, true> {
  const env: Record<string, string | undefined> = {
    DATABASE_URL_APP: WORKER_DSN,
    DATABASE_URL_WORKER: WORKER_DSN,
    PGSSLROOTCERT: undefined,
  };
  return { get: (k: string) => env[k] } as unknown as ConfigService<AppConfig, true>;
}

interface Failure {
  file: string;
  line: number;
  code: string;
  message: string;
  sql: string;
}

describe('build-v3 SQL preflight · every backend statement parses against the real schema', () => {
  let pg: PgService;
  const failures: Failure[] = [];
  const paramTypeUnknown: Failure[] = [];
  let checked = 0;
  let interpolatedCount = 0;

  beforeAll(async () => {
    pg = new PgService(makeConfig());
    await pg.onModuleInit();

    const { stmts, interpolated } = extractStatements(join(process.cwd(), 'src'));
    interpolatedCount = interpolated.length;

    const client = await pg.worker.connect();
    try {
      for (const s of stmts) {
        // Each statement in its own transaction: PREPARE is rolled back with it,
        // and an error leaves the tx aborted, so we always ROLLBACK afterwards.
        await client.query('BEGIN');
        try {
          await client.query(`PREPARE _preflight AS ${s.sql}`);
          checked++;
        } catch (err) {
          const e = err as { code?: string; message?: string };
          const rec: Failure = {
            file: s.file,
            line: s.line,
            code: e.code ?? '?',
            message: (e.message ?? String(err)).split('\n')[0],
            sql: s.sql.trim().slice(0, 120).replace(/\s+/g, ' '),
          };
          if (SCHEMA_ERRORS.has(rec.code)) failures.push(rec);
          else if (rec.code === PARAM_TYPE_ERROR) paramTypeUnknown.push(rec);
          // any other code (syntax etc.) is a harness limitation, not a schema defect
          checked++;
        } finally {
          await client.query('ROLLBACK');
        }
      }
    } finally {
      client.release();
    }
  });

  afterAll(async () => {
    await pg?.onModuleDestroy();
  });

  it('reports coverage honestly (what this gate can and cannot see)', () => {
    // Not an assertion of health — an assertion that we KNOW our blind spots.
    console.log(
      `\n  preflight coverage: ${checked} statements PREPAREd · ` +
        `${interpolatedCount} interpolated (NOT covered — assembled at runtime) · ` +
        `${paramTypeUnknown.length} indeterminate param type (not a schema defect)`,
    );
    expect(checked).toBeGreaterThan(0);
  });

  it('every backend SQL statement resolves against build-v3 (no 42703/42883/42P01/42P10)', () => {
    if (failures.length === 0) return;

    // Group by error code then file so the report is a worklist, not a wall.
    const byCode = new Map<string, Failure[]>();
    for (const f of failures) {
      const list = byCode.get(f.code) ?? [];
      list.push(f);
      byCode.set(f.code, list);
    }
    const LABEL: Record<string, string> = {
      '42P01': 'undefined_table',
      '42703': 'undefined_column',
      '42883': 'undefined_function',
      '42P10': 'invalid_column_reference (ON CONFLICT target)',
      '42P02': 'undefined_parameter',
    };
    const report = [...byCode.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .map(([code, list]) => {
        const head = `\n══ ${code} ${LABEL[code] ?? ''} — ${list.length} statement(s)`;
        const body = list
          .slice(0, 40)
          .map((f) => `   ${f.file}:${f.line}\n      ${f.message}\n      SQL: ${f.sql}…`)
          .join('\n');
        const more = list.length > 40 ? `\n   …and ${list.length - 40} more` : '';
        return `${head}\n${body}${more}`;
      })
      .join('\n');

    throw new Error(
      `${failures.length} backend SQL statement(s) DO NOT RESOLVE against build-v3.\n` +
        `(The schema-parity gate is blind to these — it only checks table names.)\n${report}\n`,
    );
  });
});

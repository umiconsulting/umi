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
 *
 * ── RECONSTRUCTION (2026-07-21) ────────────────────────────────────────────
 * "Counted, not hidden" was honest, but nobody looked inside the count — and the
 * bucket was not inert. `products.repository.ts` assembles every query from two
 * module constants (`SELECT`/`FROM`) and reads `p.price_cents` + `p.variants`,
 * NEITHER of which exists in build-v3 (it is `price`, and variants are relational).
 * Its read AND write paths both fail, and all 7 statements sat in the uncounted
 * bucket. A blind spot that large stops being a caveat and becomes a hiding place.
 *
 * So interpolated statements are now RECONSTRUCTED before being given up on:
 *   1. Same-file SQL fragment constants (`const FROM = \`FROM tenant.product p …\``)
 *      are substituted, recursively — this is the dominant pattern by far.
 *   2. Any `${…}` still left is a runtime value (an optional clause, a sort
 *      direction). It is blanked, which yields the statement's MINIMAL form.
 *
 * Blanking cannot invent a bad column reference — it only removes text — so a
 * schema error on a reconstructed statement is a REAL defect in what the developer
 * wrote literally. It can, though, produce invalid syntax or a gap in the `$n`
 * sequence, and NEITHER is a schema defect. Reconstructed statements are therefore
 * judged on the four true schema codes only; syntax and parameter errors demote the
 * statement back to "not reconstructable" and it is reported as still-uncovered.
 * The gate never converts its own reconstruction failure into someone else's bug.
 */

const WORKER_DSN =
  process.env.DATABASE_URL_WORKER ??
  'postgresql://worker_login:harness_worker@127.0.0.1:5233/umi_backfill_v3';
// The D1 boot guard (SECURITY_GATE.md §4) refuses to boot if the app pool is
// BYPASSRLS, so the app pool must connect as an INHERIT member of `api`
// (`api_login`), exactly as prod provisions it — not as the worker role.
// Statements are still PREPAREd on the worker pool (schema validity, not RLS).
const APP_DSN =
  process.env.DATABASE_URL_APP ??
  'postgresql://api_login:harness_api@127.0.0.1:5233/umi_backfill_v3';

/** Errors that mean "the schema does not have what this SQL asks for". */
const SCHEMA_ERRORS = new Set(['42P01', '42703', '42883', '42P10', '42P02']);
/**
 * The subset a RECONSTRUCTED statement may be judged on. `42P02` (undefined
 * parameter) is deliberately absent: blanking an optional clause can leave a hole
 * in the `$1,$2,$3` sequence, which says nothing about the schema.
 */
const RECONSTRUCTED_SCHEMA_ERRORS = new Set(['42P01', '42703', '42883', '42P10']);
/** Postgres cannot infer a bare `$1`'s type. Not a schema defect — reported separately. */
const PARAM_TYPE_ERROR = '42P18';

interface Stmt {
  sql: string;
  file: string;
  line: number;
  /** Set when the SQL was rebuilt from fragments/blanks rather than read verbatim. */
  reconstructed?: boolean;
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

/**
 * Module-level SQL fragment constants in one file: `const FROM = \`FROM tenant.x\``.
 * These are how this codebase shares a projection or a join across several queries,
 * and they are the single biggest reason a statement is not literal.
 */
function collectFragments(text: string): Map<string, string> {
  const frags = new Map<string, string>();
  const DECL = /(?:const|let)\s+([A-Za-z_$][\w$]*)\s*(?::[^=`]+)?=\s*`([^`]*)`/g;
  for (const m of text.matchAll(DECL)) frags.set(m[1], m[2]);
  return frags;
}

/**
 * Rebuild an interpolated statement into something PREPARE can parse.
 * Substitutes known same-file fragments (recursively — a fragment may itself
 * reference another), then blanks whatever `${…}` is left, which is by definition
 * a runtime value. Returns whether any blanking was needed, because a blanked
 * statement is judged on a narrower set of error codes.
 */
function reconstruct(body: string, frags: Map<string, string>): { sql: string; blanked: boolean } {
  let sql = body;
  // Bounded: a fragment referencing a fragment is normal, a cycle is not.
  for (let pass = 0; pass < 8 && sql.includes('${'); pass++) {
    const next = sql.replace(/\$\{\s*([A-Za-z_$][\w$]*)\s*\}/g, (whole, name: string) =>
      frags.has(name) ? (frags.get(name) as string) : whole,
    );
    if (next === sql) break;
    sql = next;
  }
  const blanked = sql.includes('${');
  // Whatever survives is an expression, not a name we can resolve statically
  // (`${locClause}`, `${isUuid ? … : ''}`). Blank it to get the minimal form.
  if (blanked) sql = sql.replace(/\$\{[^}]*\}/g, '');
  return { sql, blanked };
}

/** Pull every backtick template literal that looks like a SQL statement. */
function extractStatements(root: string): {
  stmts: Stmt[];
  reconstructed: Stmt[];
  interpolated: Stmt[];
} {
  const stmts: Stmt[] = [];
  const reconstructed: Stmt[] = [];
  const interpolated: Stmt[] = [];
  const LOOKS_LIKE_SQL = /^\s*(?:with|select|insert|update|delete)\s/i;

  for (const file of sourceFiles(root)) {
    const text = readFileSync(file, 'utf8');
    const frags = collectFragments(text);
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
      if (!body.includes('${')) {
        stmts.push({ sql: body, file: rel, line });
        continue;
      }
      // Assembled at runtime. Try to rebuild it rather than write it off — see
      // the RECONSTRUCTION note in the header. It still counts separately, so the
      // coverage line never claims a rebuilt statement is a verbatim one.
      const { sql, blanked } = reconstruct(body, frags);
      interpolated.push({ sql: body, file: rel, line });
      reconstructed.push({ sql, file: rel, line, reconstructed: blanked });
    }
  }
  return { stmts, reconstructed, interpolated };
}

function makeConfig(): ConfigService<AppConfig, true> {
  const env: Record<string, string | undefined> = {
    DATABASE_URL_APP: APP_DSN,
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
  let rebuiltChecked = 0;
  const unrebuildable: Stmt[] = [];

  beforeAll(async () => {
    pg = new PgService(makeConfig());
    await pg.onModuleInit();

    const { stmts, reconstructed, interpolated } = extractStatements(join(process.cwd(), 'src'));
    interpolatedCount = interpolated.length;

    const client = await pg.worker.connect();
    /** PREPARE one statement; returns true if the schema accepted it. */
    const prepare = async (s: Stmt, strict: boolean): Promise<boolean> => {
      // Each statement in its own transaction: PREPARE is rolled back with it,
      // and an error leaves the tx aborted, so we always ROLLBACK afterwards.
      await client.query('BEGIN');
      try {
        await client.query(`PREPARE _preflight AS ${s.sql}`);
        return true;
      } catch (err) {
        const e = err as { code?: string; message?: string };
        const rec: Failure = {
          file: s.file,
          line: s.line,
          code: e.code ?? '?',
          message: (e.message ?? String(err)).split('\n')[0],
          sql: s.sql.trim().slice(0, 120).replace(/\s+/g, ' '),
        };
        const schemaCodes = strict ? SCHEMA_ERRORS : RECONSTRUCTED_SCHEMA_ERRORS;
        if (schemaCodes.has(rec.code)) {
          failures.push(rec);
          return true; // a real verdict: the schema rejected it
        }
        if (strict && rec.code === PARAM_TYPE_ERROR) {
          paramTypeUnknown.push(rec);
          return true;
        }
        // Syntax / parameter noise. For a verbatim statement that is a harness
        // limitation; for a rebuilt one it means the rebuild was not faithful.
        return strict;
      } finally {
        await client.query('ROLLBACK');
      }
    };

    try {
      for (const s of stmts) {
        await prepare(s, true);
        checked++;
      }
      // Rebuilt statements are judged on the true schema codes only, so a failed
      // reconstruction is reported as still-uncovered — never as a schema defect.
      for (const s of reconstructed) {
        if (await prepare(s, false)) rebuiltChecked++;
        else unrebuildable.push(s);
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
    // Name the remaining blind spot instead of only sizing it — an unnamed
    // "15 uncovered" is exactly the shape the products.repository breakage hid in.
    const blind = new Map<string, number>();
    for (const s of unrebuildable) blind.set(s.file, (blind.get(s.file) ?? 0) + 1);
    const blindList = [...blind.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([f, n]) => `${f}×${n}`)
      .join(', ');

    console.log(
      `\n  preflight coverage: ${checked} statements PREPAREd verbatim · ` +
        `${rebuiltChecked}/${interpolatedCount} interpolated RECONSTRUCTED and checked · ` +
        `${unrebuildable.length} could not be rebuilt (still uncovered) · ` +
        `${paramTypeUnknown.length} indeterminate param type (not a schema defect)` +
        (blindList ? `\n  still uncovered: ${blindList}` : ''),
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

    // Per-file rollup, COMPLETE and never truncated. The detail above is capped at
    // 40 per code so the output stays readable — but reading a capped list as if it
    // were the whole worklist is how a file gets missed: products.repository.ts sat
    // below the 42703 cut and was invisible while every one of its statements failed.
    // A count you can trust beats a sample you cannot.
    const byFile = new Map<string, number>();
    for (const f of failures) byFile.set(f.file, (byFile.get(f.file) ?? 0) + 1);
    const fileRollup = [...byFile.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([file, n]) => `   ${String(n).padStart(4)}  ${file}`)
      .join('\n');

    throw new Error(
      `${failures.length} backend SQL statement(s) DO NOT RESOLVE against build-v3.\n` +
        `(The schema-parity gate is blind to these — it only checks table names.)\n${report}\n` +
        `\n══ BY FILE (complete — the detail above is capped at 40 per code)\n${fileRollup}\n`,
    );
  });
});

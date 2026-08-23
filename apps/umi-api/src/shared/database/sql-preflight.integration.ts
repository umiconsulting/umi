import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { blankComments, sourceFiles } from './sql-scan';
import { collectFragments, looksLikeSql, reconstruct } from './sql-rebuild';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/config.schema';
import { PgService } from './pg.service';

/**
 * SQL PREFLIGHT — the column-level gate.
 *
 * The schema-parity gate only checks TABLE NAMES. It is blind to columns, to
 * quoted identifiers, and to function calls — which is why 488 references to a
 * column the schema does not have (the backend said `tenant_id`; the schema has
 * only ever had one merchant key, now `merchant_id`), a missing
 * `merchant.normalize_phone()`, and an `ON CONFLICT` on a non-existent unique
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
 *   1. Same-file SQL fragment constants (`const FROM = \`FROM merchant.product p …\``)
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

/** Pull every backtick template literal that looks like a SQL statement. */
function extractStatements(root: string): {
  stmts: Stmt[];
  reconstructed: Stmt[];
  interpolated: Stmt[];
} {
  const stmts: Stmt[] = [];
  const reconstructed: Stmt[] = [];
  const interpolated: Stmt[] = [];

  for (const file of sourceFiles(root)) {
    // Comments blanked first: a doc comment that quotes SQL is documentation, not a
    // statement the database has to be able to resolve.
    const text = blankComments(readFileSync(file, 'utf8'));
    const frags = collectFragments(text, file);
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
      // Pass the preceding source so a thrown Error MESSAGE that begins with
      // a statement keyword is not counted as SQL.
      if (!looksLikeSql(body, text.slice(Math.max(0, start - 120), start))) continue;

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

/**
 * THE UNCOVERED REMAINDER — named, with a disposition for each.
 *
 * Work item 17 accepts a non-zero uncovered count only when "each exception is
 * named and accepted in writing". This is that writing, and the test below makes
 * it binding: a NEW uncovered statement fails the gate, and an entry that stops
 * being uncovered fails it too.
 *
 * Every entry here is a deliberate, permanent limit of static rebuilding. A
 * statement whose clause is chosen at run time has no single form to check.
 *
 * `trace.service.ts` held four entries until 2026-08-14. Its four tables exist
 * in no DDL, so we deleted the file instead of an acceptance of the entries. See
 * decision L20 in `docs/migration/build-v3/BACKFILL_METHODOLOGY.md`.
 */
const UNCOVERED_EXPECTED: ReadonlyArray<{ file: string; count: number; why: string }> = [
  {
    file: 'modules/kds/kds.repository.ts',
    count: 2,
    // ACCEPTED. `${limitParam}` and `${patch}` are values chosen at run time, so
    // no static rebuild can produce the statement the database will see.
    // Blanking yields the minimal form, which is judged and reported separately.
    why: 'true run-time clause; accepted 2026-08-14',
  },
  {
    file: 'modules/cash/cash.repository.ts',
    count: 1,
    // ACCEPTED, same reason: `${order}` is a sort direction chosen at run time.
    why: 'true run-time clause; accepted 2026-08-14',
  },
  {
    file: 'modules/dashboard-operations/dashboard-operations.repository.ts',
    count: 1,
    // ACCEPTED. The operations feed is assembled from a definition table —
    // `${definition.source} WHERE ${definition.where} … ORDER BY ${order}` — so the
    // statement the database sees is chosen per feed at run time. Arrived with the
    // UmiPOS integration (architectureUMIposIntegration-v2).
    why: 'true run-time clause; accepted 2026-08-22',
  },
  {
    file: 'modules/pos-customer-value/pos-customer-value.repository.ts',
    count: 1,
    // ACCEPTED. One locking read over `merchant.${table}` joined to
    // `merchant.${ledger}` on `${key}`: the value ACCOUNT (wallet vs gift card) is
    // chosen per authorization at run time. Same integration.
    why: 'true run-time clause; accepted 2026-08-22',
  },
];

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
        // PREPARE is NOT transactional — a prepared statement SURVIVES the
        // ROLLBACK above (verified: `BEGIN; PREPARE x; ROLLBACK;` leaves x in
        // pg_prepared_statements). Reusing one name therefore poisons the whole
        // run: the first statement that parses leaves `_preflight` behind, and
        // every statement after it fails 42P05 "already exists" — which is not a
        // schema code, so it was swallowed as a harness limitation while still
        // being counted as checked. That silently skipped 88 statements.
        await client.query('DEALLOCATE ALL');
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

    // UNRESOLVED and UNCOVERED are different numbers and must be read together.
    // Unresolved = measured and broken. Uncovered = never measured at all. They
    // were once both 15 by coincidence, which is exactly how a reader conflates
    // them. AB#17's acceptance asks for them side by side; until now the
    // unresolved count was thrown from a separate test and the two never met.
    console.log(
      `\n  preflight coverage: ${checked} statements PREPAREd verbatim · ` +
        `${rebuiltChecked}/${interpolatedCount} interpolated RECONSTRUCTED and checked · ` +
        `${unrebuildable.length} could not be rebuilt (still uncovered) · ` +
        `${paramTypeUnknown.length} indeterminate param type (not a schema defect)` +
        `\n  preflight verdict:  ${failures.length} UNRESOLVED (measured, broken) · ` +
        `${unrebuildable.length} UNCOVERED (never measured — not approved)` +
        (blindList ? `\n  still uncovered: ${blindList}` : ''),
    );
    expect(checked).toBeGreaterThan(0);
  });

  it('has zero unresolved SQL statements', () => {
    const detail = failures
      .map((f) => `${f.file}:${f.line} ${f.code} ${f.message}\n  ${f.sql}`)
      .join('\n');
    expect(failures, `The backend still has unresolved SQL.\n${detail}`).toEqual([]);
  });

  it('the uncovered remainder is exactly the list that is named and accepted', () => {
    const actual = new Map<string, number>();
    for (const st of unrebuildable) actual.set(st.file, (actual.get(st.file) ?? 0) + 1);

    const expected = new Map(UNCOVERED_EXPECTED.map((e) => [e.file, e.count]));
    const problems: string[] = [];

    for (const [file, n] of actual) {
      const want = expected.get(file);
      if (want === undefined) {
        problems.push(
          `   NEW uncovered file: ${file} (${n}) — measure it, or name it in UNCOVERED_EXPECTED`,
        );
      } else if (want !== n) {
        problems.push(`   ${file}: expected ${want} uncovered, found ${n}`);
      }
    }
    for (const [file, n] of expected) {
      if (!actual.has(file)) {
        problems.push(`   ${file}: expected ${n} uncovered, found 0 — FIXED. Delete the entry.`);
      }
    }

    if (problems.length > 0) {
      throw new Error(
        `The uncovered set no longer matches the written exceptions.\n${problems.join('\n')}\n\n` +
          `An unmeasured statement is never approved. Either make the gate able to\n` +
          `rebuild it, or name it with a reason.\n`,
      );
    }
  });
});

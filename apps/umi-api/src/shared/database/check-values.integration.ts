import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/config.schema';
import { PgService } from './pg.service';
import { blankComments, sourceFiles } from './sql-scan';
import { LOCATION_STATUSES } from '../../modules/merchants/dto/update-location.dto';

/**
 * CHECK-VALUE GATE — the gate `sql-preflight` structurally cannot be.
 *
 * Preflight PREPAREs every statement, so it catches every name the schema does not
 * have. It cannot catch a VALUE the schema does not admit, and not for want of trying:
 * Postgres tests a CHECK constraint at RUN time (23514), never at parse time. A query
 * comparing a column to a string no CHECK allows PREPAREs perfectly and then matches
 * zero rows forever.
 *
 * That failure mode is silent by construction — the query succeeds, returns nothing or
 * everything, and no error is ever raised. It has already cost us twice:
 *
 *   1. `cash-scan.isAfterHours` compared times in SQL, so `01:00 >= closes_at` held for
 *      every window and every late-night scan read as after-hours.
 *   2. `listLocationProfiles` filtered `status <> 'archived'` after build-v3 narrowed
 *      location statuses to ('active','closed'). It read as a filter and behaved as a
 *      no-op — nothing could ever be excluded.
 *
 * Both were found by a person reading a statement, which does not scale.
 *
 * HOW. Read every enumerated CHECK from the live database (the schema is the authority,
 * not a hand-kept list here), then scan each backend SQL literal for
 * `column = 'value'` / `<> 'value'` / `!= 'value'` and confirm the value is one the
 * column's CHECK admits.
 *
 * SCOPED BY TABLE, which is the whole difficulty. Unioning the allowed values of every
 * `status` column across the schema hides exactly the bug we are hunting:
 * `merchant.station.status` does admit 'archived', so a union-based check calls
 * `location.status <> 'archived'` legal. This resolves the tables each statement
 * actually references and uses only those.
 *
 * DELIBERATELY CONSERVATIVE. A statement whose table cannot be resolved is SKIPPED, not
 * failed, and skips are counted and reported. This gate exists to catch a defect nobody
 * can see; it must never invent one, or it becomes the next gate people learn to read
 * past.
 */

const WORKER_DSN =
  process.env.DATABASE_URL_WORKER ??
  'postgresql://worker_login:harness_worker@127.0.0.1:5233/umi_backfill_v3';
const APP_DSN =
  process.env.DATABASE_URL_APP ??
  'postgresql://api_login:harness_api@127.0.0.1:5233/umi_backfill_v3';

function makeConfig(): ConfigService<AppConfig, true> {
  const env: Record<string, string | undefined> = {
    DATABASE_URL_APP: APP_DSN,
    DATABASE_URL_WORKER: WORKER_DSN,
    PGSSLROOTCERT: undefined,
  };
  return { get: (k: string) => env[k] } as unknown as ConfigService<AppConfig, true>;
}

/** table name (unqualified) -> column -> the values its CHECK admits. */
type Catalog = Map<string, Map<string, Set<string>>>;

const TEMPLATE = /`([^`]*?)`/gs;
const IS_SQL = /\b(SELECT|INSERT|UPDATE|DELETE)\b/i;
/** `FROM merchant.x`, `JOIN umi.y`, `UPDATE runtime.z`, `INSERT INTO merchant.w`. */
const TABLE_REF = /\b(?:FROM|JOIN|UPDATE|INTO)\s+(?:umi|merchant|runtime)\.("?)(\w+)\1/gi;
/**
 * `col = 'v'`, `t.col <> 'v'`, `col != 'v'`. Single-quoted lowercase identifiers only —
 * the shape every enumerated value in this schema takes. A value with a space or a
 * capital is prose or a message, not an enum member.
 */
const LITERAL = /\b(?:\w+\.)?(\w+)\s*(=|<>|!=)\s*'([a-z][a-z_]*)'/g;

interface Finding {
  file: string;
  line: number;
  column: string;
  operator: string;
  value: string;
  allowed: string[];
  tables: string[];
}

describe('build-v3 CHECK values · every compared literal is one the schema admits', () => {
  let pg: PgService;
  const findings: Finding[] = [];
  let statementsScanned = 0;
  let comparisonsChecked = 0;
  let skippedNoTable = 0;

  beforeAll(async () => {
    pg = new PgService(makeConfig());
    await pg.onModuleInit();
  });

  afterAll(async () => {
    await pg?.onModuleDestroy?.();
  });

  it('no SQL literal is compared against a value its CHECK forbids', async () => {
    // The live schema is the authority. Only single-column `x = ANY (ARRAY[...])`
    // CHECKs are usable here; a compound or expression CHECK has no single column to
    // attribute the values to, and is left out rather than guessed at.
    const { rows } = await pg.query<{ table_name: string; def: string }>(
      `SELECT c.relname AS table_name, pg_get_constraintdef(k.oid) AS def
         FROM pg_constraint k
         JOIN pg_class     c ON c.oid = k.conrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE k.contype = 'c'
          AND n.nspname IN ('umi','merchant','runtime')`,
    );

    const catalog: Catalog = new Map();
    for (const r of rows) {
      const head = /^CHECK \(\((\w+) = ANY \(ARRAY\[/.exec(r.def);
      if (!head) continue;
      const values = [...r.def.matchAll(/'([^']*)'::text/g)].map((m) => m[1]);
      if (!values.length) continue;
      const byColumn = catalog.get(r.table_name) ?? new Map<string, Set<string>>();
      const set = byColumn.get(head[1]) ?? new Set<string>();
      values.forEach((v) => set.add(v));
      byColumn.set(head[1], set);
      catalog.set(r.table_name, byColumn);
    }
    expect(catalog.size).toBeGreaterThan(0);

    for (const file of sourceFiles(join(__dirname, '..', '..'))) {
      const text = blankComments(readFileSync(file, 'utf8'));
      for (const t of text.matchAll(TEMPLATE)) {
        const sql = t[1];
        if (!IS_SQL.test(sql)) continue;

        const tables = [...sql.matchAll(TABLE_REF)].map((m) => m[2].toLowerCase());
        if (!tables.length) continue;
        statementsScanned++;

        // Union the CHECKs of the tables THIS statement touches. Still a union, but a
        // bounded one: a two-table join genuinely could compare either side's column,
        // and preferring a false negative to a false accusation is the rule here.
        const allowed = new Map<string, Set<string>>();
        let known = false;
        for (const table of tables) {
          const byColumn = catalog.get(table);
          if (!byColumn) continue;
          known = true;
          for (const [column, values] of byColumn) {
            const merged = allowed.get(column) ?? new Set<string>();
            values.forEach((v) => merged.add(v));
            allowed.set(column, merged);
          }
        }
        if (!known) {
          skippedNoTable++;
          continue;
        }

        for (const m of sql.matchAll(LITERAL)) {
          const [, column, operator, value] = m;
          const values = allowed.get(column);
          if (!values) continue;
          comparisonsChecked++;
          if (values.has(value)) continue;
          findings.push({
            file: file.replace(/.*\/src\//, ''),
            line: text.slice(0, t.index + m.index).split('\n').length,
            column,
            operator,
            value,
            allowed: [...values].sort(),
            tables: [...new Set(tables)].sort(),
          });
        }
      }
    }

    const report =
      `\n══ CHECK-VALUE GATE\n` +
      `   ${statementsScanned} statement(s) scanned · ${comparisonsChecked} comparison(s) ` +
      `checked · ${skippedNoTable} skipped (no CHECK on any referenced table)\n`;
    console.log(report);

    const detail = findings
      .map(
        (f) =>
          `   ${f.file}:${f.line}\n` +
          `      ${f.column} ${f.operator} '${f.value}' — impossible.\n` +
          `      ${f.tables.join(', ')} admit: ${f.allowed.join(', ')}`,
      )
      .join('\n');

    expect(
      findings.length,
      `${findings.length} SQL literal(s) compare a column against a value its CHECK ` +
        `constraint does not admit. The statement PREPAREs and runs; it simply can never ` +
        `match. Postgres tests a CHECK at run time, so sql-preflight cannot see this.\n\n` +
        `${detail}\n`,
    ).toBe(0);
  });

  /**
   * THE OTHER HALF OF THE SAME DEFECT, which the scan above structurally cannot see.
   *
   * That scan reads SQL literals. A DTO's `@IsIn([...])` is not SQL — it is a
   * TypeScript array — so when `UpdateLocationDto` said ('active','inactive',
   * 'archived') while `merchant.location.status` said ('active','closed'), nothing
   * anywhere disagreed. The result was a control that could not be operated at all:
   * the one legal value was refused by the validator as a 400, and the two the
   * validator accepted reached Postgres and came back 23514, which the operator saw
   * as a 500.
   *
   * This is an EXACT pin rather than a heuristic, deliberately. The gate's own rule
   * is that it must never invent a finding, and mapping arbitrary DTO fields to
   * columns would be guesswork. One constant, one column, named on both sides.
   */
  it('the location-status DTO admits exactly what the CHECK admits', async () => {
    const { rows } = await pg.query<{ def: string }>(
      `SELECT pg_get_constraintdef(k.oid) AS def
         FROM pg_constraint k
         JOIN pg_class     c ON c.oid = k.conrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE k.contype = 'c' AND n.nspname = 'merchant' AND c.relname = 'location'
          AND pg_get_constraintdef(k.oid) LIKE '%status%'`,
    );
    const allowed = new Set(
      rows.flatMap((r) => [...r.def.matchAll(/'([^']*)'::text/g)].map((m) => m[1])),
    );
    expect(allowed.size, 'no enumerated CHECK found on merchant.location.status').toBeGreaterThan(
      0,
    );
    expect([...allowed].sort()).toEqual([...LOCATION_STATUSES].sort());
  });
});

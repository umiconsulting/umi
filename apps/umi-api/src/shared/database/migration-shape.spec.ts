import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * THE SHAPE OF A RE-RUNNABLE MIGRATION, checked without a database.
 *
 * After the cutover the numbered DDL files freeze and a schema change arrives as
 * a file in `docs/migration/build-v3/migrations/`. That file runs against the
 * database holding the customers, by hand, inside a maintenance window. A
 * half-applied migration leaves a person reading a failed transcript and
 * guessing what landed.
 *
 * The rule: the same file applied twice either succeeds, or fails with a
 * message. It never leaves half of its work behind.
 *
 * TWO HALVES, AND THIS IS THE CHEAP ONE. The proof that a file really applies
 * twice needs a database and the rights to change it, so it runs in the `gate`
 * CI job as the owner — see `umi-api-ci.yml`. What lives here is the structural
 * half: it needs no database, so it runs in the ordinary `pnpm test` gate on
 * every pull request, and it catches the guard somebody forgot to write.
 *
 * `90_rls.sql` is why the rule exists. It carried 21 `create policy` and no
 * `drop policy`, so a second apply died with `policy "merchant_isolation" for
 * table "merchant" already exists`. Nothing tested a second apply.
 */

const BUILD_V3 = join(__dirname, '../../../../../docs/migration/build-v3');
const MIGRATIONS_DIR = join(BUILD_V3, 'migrations');

/**
 * The SQL with its comments removed.
 *
 * ⚠️ Do not use `blankComments` from `sql-scan.ts` here. That helper scans
 * TYPESCRIPT, so it treats a backtick as a string delimiter and stops blanking
 * at one. A SQL comment quotes an identifier in backticks all the time, and this
 * spec quoted the very statement it forbids — so the scan read a warning as the
 * statement it warns about.
 *
 * SQL has two comment forms and no backtick string.
 */
function sqlCode(text: string): string {
  const noBlocks = text.replace(/\/\*[\s\S]*?\*\//g, ' ');
  return noBlocks
    .split('\n')
    .map((line) => {
      // A `--` inside a string is text, not a comment. Walk the line and track
      // the quote instead of cutting at the first `--`, which would truncate a
      // statement and hide whatever followed.
      let quoted = false;
      for (let i = 0; i < line.length; i++) {
        if (line[i] === "'") quoted = !quoted;
        else if (!quoted && line[i] === '-' && line[i + 1] === '-') return line.slice(0, i);
      }
      return line;
    })
    .join('\n');
}

/** The `.sql` files in the migrations directory, in apply order. */
function migrationFiles(): string[] {
  try {
    return readdirSync(MIGRATIONS_DIR)
      .filter((name) => name.endsWith('.sql'))
      .sort();
  } catch {
    return [];
  }
}

/**
 * Every `create policy` in the text, with the policy name and the table.
 *
 * ⚠️ Match across a line break. A statement written as `create policy\n  name on
 * table` is the same statement, and a pattern anchored to one line does not see
 * it. An unguarded policy would then keep the counts equal and pass.
 */
const CREATE_POLICY = /create\s+policy\s+(\w+)\s+on\s+([\w.%]+)/gi;
const DROP_POLICY = /drop\s+policy\s+if\s+exists\s+(\w+)\s+on\s+([\w.%]+)/gi;

/** The (policy, table) pairs a pattern finds, as `name@table`. */
function pairs(sql: string, re: RegExp): string[] {
  return [...sql.matchAll(re)].map((m) => `${m[1].toLowerCase()}@${m[2].toLowerCase()}`);
}

describe('90_rls.sql · re-runnable by construction', () => {
  const sql = readFileSync(join(BUILD_V3, '90_rls.sql'), 'utf8');

  it('guards every `create policy` with a drop OF THE SAME POLICY ON THE SAME TABLE', () => {
    // Counting is not enough. 21 drops that all name the wrong table would keep
    // the totals equal, remove live policies, and still let the second apply
    // fail. Bind each create to a drop by name AND table.
    const creates = pairs(sql, CREATE_POLICY);
    const drops = new Set(pairs(sql, DROP_POLICY));
    expect(creates.length, 'the file must still create policies').toBe(21);
    const unguarded = creates.filter((c) => !drops.has(c));
    expect(
      unguarded,
      '`create policy` has no `if not exists`. Write `drop policy if exists NAME on TABLE;` first.',
    ).toEqual([]);
  });

  it('guards the DYNAMIC policies too, the ones built inside `execute format`', () => {
    // Four policies are built by a loop, so a reader does not see them as
    // statements. A guard written only for the visible ones leaves these four
    // unprotected. They are the broadest policies in the file: two sweep the
    // merchant tables (by `merchant_id`, and by parent for the child tables),
    // one sweeps every table with a `location_id`, and one covers the named
    // device tables.
    const dynamicCreates = sql.match(/execute format\(\$f\$create policy/g) ?? [];
    const dynamicDrops = sql.match(/execute format\('drop policy if exists/g) ?? [];
    expect(dynamicCreates.length).toBeGreaterThan(0);
    expect(dynamicDrops.length).toBe(dynamicCreates.length);
  });

  it('binds each dynamic drop to the same loop variable as its create', () => {
    // A drop that names the wrong table removes nothing, and the create that
    // follows then fails on the second apply — or worse, succeeds against a
    // table nobody meant to touch.
    const lines = sql.split('\n');
    for (const [i, line] of lines.entries()) {
      const drop = line.match(
        /execute format\('drop policy if exists \w+ on \w+\.%I',\s*([\w.]+)\)/,
      );
      if (!drop) continue;
      // The create is the next statement, and its identifier argument is the
      // LAST argument of its own `format(...)` call.
      const create = lines.slice(i + 1, i + 12).join('\n');
      expect(create, `line ${i + 1}: a dynamic drop must be followed by its create`).toMatch(
        /execute format\(\$f\$create policy/,
      );
      expect(create, `line ${i + 1}: drop and create must name the same table`).toContain(drop[1]);
    }
  });
});

describe('forward migrations · the shape every file must take', () => {
  it('names what it found, so a run over an empty directory is visible', () => {
    const files = migrationFiles();
    // A suite that silently tests nothing reads exactly like one that tested
    // everything and passed.
    console.log(
      files.length === 0
        ? '  forward migrations: none (the directory is open, and empty)'
        : `  forward migrations: ${files.length} — ${files.join(', ')}`,
    );
    expect(files.length).toBeGreaterThan(0);
  });

  it('numbers each migration once, so the apply order is not ambiguous', () => {
    const numbers = migrationFiles().map((name) => name.slice(0, 3));
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  it('names every file `NNN_description.sql`', () => {
    for (const file of migrationFiles()) {
      expect(file).toMatch(/^\d{3}_[a-z0-9_]+\.sql$/);
    }
  });

  for (const file of migrationFiles()) {
    describe(file, () => {
      // Scan the CODE, not the prose. The first version of this spec failed on
      // its own example file, because that file's warning quotes the statement
      // it tells you not to write.
      const sql = sqlCode(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));

      it('opens no transaction of its own', () => {
        // The caller owns the transaction (`psql --single-transaction`). A file
        // that opens one takes `create index concurrently` away from its author,
        // because that statement cannot run inside a transaction.
        expect(sql).not.toMatch(/^\s*begin\s*;/im);
      });

      it('guards every `create policy` with a drop', () => {
        const creates = sql.match(/create policy \w+ on/gi) ?? [];
        const drops = sql.match(/drop policy if exists \w+ on/gi) ?? [];
        expect(drops.length).toBe(creates.length);
      });

      it('does NOT disable an append-only trigger by hand', () => {
        // `merchant.with_append_only_writable` is the safe form. It restores the
        // trigger on the failure path as well as the success path. A bare
        // `disable trigger` leaves the table open when the next statement fails,
        // and two of the nine protected tables hold money.
        // `session_replication_role = replica` is the OTHER way to silence a
        // trigger, and it silences EVERY trigger in the session at once. It is
        // worse than the bare disable, not better.
        const bypasses = [
          ...(sql.match(/alter\s+table[^;]*disable\s+trigger/gi) ?? []),
          ...(sql.match(/session_replication_role\s*=\s*'?replica/gi) ?? []),
        ];
        expect(
          bypasses,
          'use merchant.with_append_only_writable — see docs/migration/build-v3/migrations/README.md',
        ).toEqual([]);
      });
    });
  }
});

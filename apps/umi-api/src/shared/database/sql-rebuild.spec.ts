import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { collectFragments, looksLikeSql, reconstruct } from './sql-rebuild';

/**
 * The gate's own logic, tested.
 *
 * `sql-preflight.integration.ts` needs a live build-v3 database, so it runs only
 * in the `gate` CI job. The REBUILD half needs no database at all, and it is the
 * half that decides whether a statement gets measured or lands in the uncovered
 * bucket. It had no test.
 *
 * That matters more than it sounds. An over-eager rebuild invents a defect that
 * is not there; a timid one leaves a statement unmeasured and reports the number
 * as coverage. `products.repository.ts` hid 13 broken statements in that bucket
 * while all three gates were green.
 */

const tmp = () => mkdtempSync(join(tmpdir(), 'sql-rebuild-'));

describe('collectFragments · same-file declarations', () => {
  it('collects a SQL fragment declared as a template literal', () => {
    const frags = collectFragments('const FROM = `FROM merchant.product p`;');
    expect(frags.get('FROM')).toBe('FROM merchant.product p');
  });

  it('collects a typed declaration', () => {
    const frags = collectFragments('const SEL: string = `SELECT p.id`;');
    expect(frags.get('SEL')).toBe('SELECT p.id');
  });

  it('collects a NUMBER, which a fragment may embed', () => {
    // lifecycle.repository.ts builds its cycle arithmetic from an integer
    // constant. Collecting only template literals left four statements
    // unrebuildable for the sake of one number.
    const frags = collectFragments('const DEFAULT_VISITS_REQUIRED = 10;');
    expect(frags.get('DEFAULT_VISITS_REQUIRED')).toBe('10');
  });

  it('collects a quoted string', () => {
    const frags = collectFragments("const STATUS = 'active';");
    expect(frags.get('STATUS')).toBe('active');
  });

  it('does NOT collect an expression. A gate that guesses is worse than one that reports', () => {
    const frags = collectFragments('const N = compute() + 1;');
    expect(frags.has('N')).toBe(false);
  });

  it('reads a NESTED template whole, instead of stopping at the first backtick', () => {
    // `[^`]*` stops at the first backtick, so this fragment used to arrive
    // TRUNCATED at "SELECT ". Substitution ADDS text, so a truncated fragment can
    // rebuild into a statement that PREPAREs green while the real SQL is never
    // checked. That is a false green, which is the one result this gate must
    // never produce.
    const src = 'const Q = `SELECT ${flag ? `a` : `b`} FROM merchant.product`;';
    expect(collectFragments(src).get('Q')).toBe('SELECT ${flag ? `a` : `b`} FROM merchant.product');
  });

  it('reads a fragment that follows a nested one, so the scan stays aligned', () => {
    const src = 'const A = `SELECT ${x ? `p` : `q`} FROM t`;\nconst B = `FROM merchant.customer`;';
    const frags = collectFragments(src);
    expect(frags.get('B')).toBe('FROM merchant.customer');
  });

  it('skips an unterminated literal rather than guessing at its content', () => {
    expect(collectFragments('const BROKEN = `SELECT 1').has('BROKEN')).toBe(false);
  });
});

describe('collectFragments · imported declarations', () => {
  it('resolves a fragment imported from a relative module', () => {
    // auth.repository.ts imports PLATFORM_GRANT_CTE from rbac.sql.ts. Reading
    // same-file fragments only left three statements permanently uncovered.
    const dir = tmp();
    writeFileSync(join(dir, 'rbac.sql.ts'), 'export const GRANT_CTE = `WITH g AS (SELECT 1)`;');
    const caller = join(dir, 'auth.repository.ts');
    writeFileSync(caller, "import { GRANT_CTE } from './rbac.sql';");

    const frags = collectFragments("import { GRANT_CTE } from './rbac.sql';", caller);
    expect(frags.get('GRANT_CTE')).toBe('WITH g AS (SELECT 1)');
  });

  it('imports only the names the file actually asks for', () => {
    const dir = tmp();
    writeFileSync(
      join(dir, 'frags.ts'),
      'export const WANTED = `FROM a`;\nexport const OTHER = `FROM b`;',
    );
    const caller = join(dir, 'caller.ts');
    const src = "import { WANTED } from './frags';";
    writeFileSync(caller, src);

    const frags = collectFragments(src, caller);
    expect(frags.get('WANTED')).toBe('FROM a');
    expect(frags.has('OTHER')).toBe(false);
  });

  it('lets a local declaration shadow an import, as JavaScript does', () => {
    const dir = tmp();
    writeFileSync(join(dir, 'frags.ts'), 'export const F = `FROM imported`;');
    const caller = join(dir, 'caller.ts');
    const src = "import { F } from './frags';\nconst F = `FROM local`;";
    writeFileSync(caller, src);

    expect(collectFragments(src, caller).get('F')).toBe('FROM local');
  });

  it('skips a package import even when a file of that name sits beside it', () => {
    // The earlier version of this test imported 'node:fs' and asserted an empty
    // result. That passed whether or not the guard existed, because the path was
    // unreadable either way. Put a REAL readable file at the resolved location,
    // so only the package-import guard can keep it out.
    const dir = tmp();
    writeFileSync(join(dir, 'frags.ts'), 'export const TRAP = `FROM merchant.customer`;');
    const caller = join(dir, 'caller.ts');
    const src = "import { TRAP } from 'frags';"; // no leading './' — a package specifier
    writeFileSync(caller, src);
    expect(collectFragments(src, caller).has('TRAP')).toBe(false);
  });

  it('does not throw when the imported file cannot be read', () => {
    const dir = tmp();
    const caller = join(dir, 'caller.ts');
    const src = "import { GONE } from './missing';";
    writeFileSync(caller, src);
    expect(() => collectFragments(src, caller)).not.toThrow();
  });
});

describe('reconstruct', () => {
  const frags = new Map([
    ['FROM', 'FROM merchant.product p'],
    ['SEL', 'SELECT p.id, p.price'],
  ]);

  it('substitutes a known fragment', () => {
    const r = reconstruct('${SEL} ${FROM}', frags);
    expect(r.sql).toBe('SELECT p.id, p.price FROM merchant.product p');
    expect(r.blanked).toBe(false);
  });

  it('substitutes recursively, because a fragment may reference another', () => {
    const nested = new Map([
      ['INNER', 'merchant.product'],
      ['OUTER', 'FROM ${INNER}'],
    ]);
    expect(reconstruct('SELECT 1 ${OUTER}', nested).sql).toBe('SELECT 1 FROM merchant.product');
  });

  it('blanks an unknown interpolation and says so', () => {
    const r = reconstruct('SELECT 1 ${runtimeClause}', frags);
    expect(r.sql).toBe('SELECT 1 ');
    // The caller judges a blanked statement on the four schema codes only.
    expect(r.blanked).toBe(true);
  });

  it('BLANKING ONLY REMOVES TEXT — it can never invent a column reference', () => {
    // This is the property the whole gate rests on. If blanking could ADD a
    // name, a schema error on a rebuilt statement would not prove a real defect.
    const r = reconstruct('SELECT a, ${x} b FROM t', frags);
    expect(r.sql).not.toMatch(/\$\{/);
    // Every identifier that survives was already written by a person. Assert the
    // exact output, not that it merely got shorter.
    expect(r.sql).toBe('SELECT a,  b FROM t');
  });

  it('terminates on a cycle instead of hanging', () => {
    const cyclic = new Map([
      ['A', '${B}'],
      ['B', '${A}'],
    ]);
    const r = reconstruct('${A}', cyclic);
    expect(r.blanked).toBe(true);
  });

  it('leaves a literal statement untouched', () => {
    const r = reconstruct('SELECT 1', frags);
    expect(r.sql).toBe('SELECT 1');
    expect(r.blanked).toBe(false);
  });
});

describe('looksLikeSql', () => {
  it('accepts the statement keywords', () => {
    for (const sql of ['SELECT 1', ' insert into t values (1)', 'WITH a AS (SELECT 1) SELECT 1']) {
      expect(looksLikeSql(sql)).toBe(true);
    }
  });

  it('rejects prose that does not start with a statement keyword', () => {
    expect(looksLikeSql('hello world')).toBe(false);
  });

  it('REJECTS AN ERROR MESSAGE that happens to start with a keyword', () => {
    // conversation-turns.repository.ts:168 throws a message beginning with
    // "update". It was counted as an unrebuildable SQL statement — a permanent
    // entry in the uncovered list for a string no database will ever see.
    expect(looksLikeSql('update failed for turn', 'throw new Error(')).toBe(false);
    expect(looksLikeSql('update failed for turn', 'throw ')).toBe(false);
  });

  it('still accepts real SQL that follows a call', () => {
    expect(looksLikeSql('SELECT 1', 'await this.pg.query(')).toBe(true);
  });

  it('rejects an SQL-shaped MESSAGE passed to a logger', () => {
    // Work item 18 step 2 asks for "the literal must reach a query() call".
    // That rule would hide most of the suite, because SQL here is usually
    // assigned to a const first. The gate excludes message positions instead,
    // and a logger argument is one.
    expect(looksLikeSql('update skipped for card', 'this.logger.warn(')).toBe(false);
    expect(looksLikeSql('select failed', 'console.error(')).toBe(false);
  });

  it('does not require a query call — most SQL here is assigned to a const first', () => {
    // A stricter rule would hide most of the suite, which is worse than the
    // false positive it removes.
    expect(looksLikeSql('SELECT 1', 'const SQL = ')).toBe(true);
  });
});

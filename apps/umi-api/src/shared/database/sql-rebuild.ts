import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { blankComments } from './sql-scan';

/**
 * REBUILDING AN INTERPOLATED SQL STATEMENT.
 *
 * The preflight can only judge a statement it can hand to PREPARE. A statement
 * assembled from `${...}` is not literal, so it must be rebuilt first — and a
 * statement the gate cannot rebuild is UNCOVERED, which is not the same as
 * approved. `products.repository.ts` sat in that bucket with 13 broken
 * statements while every gate reported green.
 *
 * This module is the rebuild half, extracted from the integration suite so it
 * can be unit tested. It touches no database and no network, so its spec runs in
 * the ordinary `pnpm --filter @umi/api test` gate.
 *
 * The rules that keep the gate honest live here:
 *
 *   - Blanking can only REMOVE text, so it can never invent a bad column. A
 *     schema error on a rebuilt statement is therefore a real defect.
 *   - Blanking CAN produce invalid syntax or a gap in the `$n` sequence, and
 *     neither is a schema defect. The caller judges a blanked statement on the
 *     four schema codes only.
 *   - The gate never reports its own rebuild failure as someone else's bug.
 */

/** A `${...}` that names a single identifier, which is the only kind we resolve. */
const INTERPOLATION = /\$\{\s*([A-Za-z_$][\w$]*)\s*\}/g;

/**
 * Module-level SQL fragment constants: `const FROM = \`FROM merchant.product p\``.
 * This is how the codebase shares a projection or a join between queries, and it
 * is the single biggest reason a statement is not literal.
 */
const TEMPLATE_DECL = /(?:const|let)\s+([A-Za-z_$][\w$]*)\s*(?::[^=`]+)?=\s*`([^`]*)`/g;

/**
 * Scalar constants: `const DEFAULT_VISITS_REQUIRED = 10;`
 *
 * A fragment may embed a NUMBER rather than another fragment —
 * `lifecycle.repository.ts` builds its cycle arithmetic that way. Collecting
 * only template literals left four statements unrebuildable for the sake of one
 * integer. Strings are collected too, single or double quoted.
 *
 * Deliberately narrow: a literal number or a quoted string, and nothing else. An
 * expression could change meaning when substituted, and a gate that guesses is
 * worse than a gate that reports.
 */
const SCALAR_DECL =
  /(?:const|let)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(\d+(?:\.\d+)?|'[^'\n]*'|"[^"\n]*")\s*[;\n]/g;

/** `import { A, B } from './x'` — the specifiers and the module path. */
const NAMED_IMPORT = /import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g;

/**
 * Every fragment a file can see: its own, then the ones it imports.
 *
 * Own fragments win. A local declaration shadows an import in JavaScript, so it
 * must shadow one here too, or the gate rebuilds a statement the runtime would
 * never produce.
 *
 * Imports are followed ONE level and only for relative paths. One level is what
 * the codebase actually does — `auth.repository.ts` imports `PLATFORM_GRANT_CTE`
 * straight from `rbac.sql.ts`. Following further would buy little and would need
 * cycle handling. A package import is skipped: no dependency ships SQL fragments,
 * and reading `node_modules` for this would be slow and wrong.
 */
export function collectFragments(text: string, filePath?: string): Map<string, string> {
  const frags = new Map<string, string>();

  if (filePath) {
    for (const imp of text.matchAll(NAMED_IMPORT)) {
      const spec = imp[2];
      if (!spec.startsWith('.')) continue;
      const names = imp[1]
        .split(',')
        .map((n) =>
          n
            .trim()
            .split(/\s+as\s+/)[0]
            .trim(),
        )
        .filter(Boolean);
      if (names.length === 0) continue;

      const imported = readModule(filePath, spec);
      if (!imported) continue;
      // Only the names this file actually imports, so an unrelated constant in
      // the other file cannot silently take part in a rebuild here.
      const theirs = collectOwn(imported);
      for (const name of names) {
        const value = theirs.get(name);
        if (value !== undefined) frags.set(name, value);
      }
    }
  }

  for (const [name, value] of collectOwn(text)) frags.set(name, value);
  return frags;
}

/** The fragments and scalars declared in one file's own text. */
function collectOwn(text: string): Map<string, string> {
  const frags = new Map<string, string>();
  for (const m of text.matchAll(TEMPLATE_DECL)) frags.set(m[1], m[2]);
  for (const m of text.matchAll(SCALAR_DECL)) {
    // A template declaration for the same name wins: it is the SQL one.
    if (frags.has(m[1])) continue;
    frags.set(m[1], m[2].replace(/^['"]|['"]$/g, ''));
  }
  return frags;
}

/** Read a relative import, trying the extensions this codebase uses. */
function readModule(fromFile: string, spec: string): string | null {
  const base = resolve(dirname(fromFile), spec);
  for (const candidate of [base, `${base}.ts`, `${base}/index.ts`]) {
    try {
      return blankComments(readFileSync(candidate, 'utf8'));
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Rebuild an interpolated statement into something PREPARE can parse.
 *
 * Substitutes known fragments recursively — a fragment may reference another —
 * then blanks whatever `${...}` is left, which is by definition a runtime value.
 * Reports whether any blanking happened, because a blanked statement is judged
 * on a narrower set of error codes.
 */
export function reconstruct(
  body: string,
  frags: Map<string, string>,
): { sql: string; blanked: boolean } {
  let sql = body;
  // Bounded: a fragment referencing a fragment is normal, a cycle is not.
  for (let pass = 0; pass < 8 && sql.includes('${'); pass++) {
    const next = sql.replace(INTERPOLATION, (whole, name: string) =>
      frags.has(name) ? (frags.get(name) as string) : whole,
    );
    if (next === sql) break;
    sql = next;
  }
  const blanked = sql.includes('${');
  // Whatever survives is an expression, not a name we can resolve statically
  // (`${locClause}`, `${isUuid ? ... : ''}`). Blank it for the minimal form.
  if (blanked) sql = sql.replace(/\$\{[^}]*\}/g, '');
  return { sql, blanked };
}

const SQL_SHAPED = /^\s*(?:with|select|insert|update|delete)\s/i;

/**
 * Does this template literal look like a statement the database must resolve?
 *
 * The shape test alone is not enough. `conversation-turns.repository.ts:168`
 * throws an Error whose MESSAGE begins with the word "update", and the gate
 * counted it as an unrebuildable statement — a permanent entry in the uncovered
 * list for a string no database will ever see.
 *
 * `precededBy` is the source text immediately before the literal. A literal that
 * is an argument to `new Error(...)`, or that follows `throw`, is a message.
 *
 * The check stays deliberately narrow. Requiring every literal to sit at a
 * `query(` call would be stricter and WRONG: the dominant pattern here assigns
 * SQL to a `const` and passes it somewhere else entirely, so that rule would
 * hide most of the suite.
 */
export function looksLikeSql(body: string, precededBy = ''): boolean {
  if (!SQL_SHAPED.test(body)) return false;
  const tail = precededBy.slice(-80);
  if (/\bnew\s+(?:\w*Error|\w*Exception)\s*\(\s*$/.test(tail)) return false;
  if (/\bthrow\s+$/.test(tail)) return false;
  return true;
}

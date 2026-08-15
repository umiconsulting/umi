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
 * This module is the rebuild half. It was moved out of the integration suite,
 * so a unit test can reach it. It touches no database and no network, so its spec runs in
 * the ordinary `pnpm --filter @umi/api test` gate.
 *
 * The rules that keep the gate honest live here:
 *
 *   - BLANKING can only remove text. It can never invent a column name.
 *   - SUBSTITUTION does add text, so it must add the RIGHT text. A truncated
 *     fragment would rebuild a statement that PREPAREs green while the real SQL
 *     goes unchecked, and a false green is the one result this gate must never
 *     produce. `readTemplate` reads a literal whole for that reason.
 *   - Blanking CAN produce invalid syntax or a gap in the `$n` sequence, and
 *     neither is a schema defect. The caller judges a blanked statement on the
 *     four schema codes only.
 *   - The gate never reports its own rebuild failure as someone else's bug.
 */

/** A `${...}` that names a single identifier, which is the only kind we resolve. */
const INTERPOLATION = /\$\{\s*([A-Za-z_$][\w$]*)\s*\}/g;

/**
 * A SQL fragment constant: `const FROM = \`FROM merchant.product p\``.
 * The codebase shares a projection or a join this way.
 * It is the largest single reason that a statement is not literal.
 */
const TEMPLATE_DECL_HEAD = /(?:const|let)\s+([A-Za-z_$][\w$]*)\s*(?::[^=`]+)?=\s*`/g;

/**
 * Read a whole template literal, starting at its opening backtick.
 *
 * A regular expression cannot do this. `` `([^`]*)` `` stops at the FIRST
 * backtick, so a nested template — `` `SELECT ${flag ? `a` : `b`} FROM t` `` —
 * yields a TRUNCATED fragment. That truncation is the dangerous kind of wrong:
 * substitution ADDS text, so a truncated fragment can rebuild into a statement
 * that PREPAREs green while the real SQL was never checked. The gate would then
 * count it as covered.
 *
 * This walks the literal instead, and tracks `${ ... }` depth so a backtick
 * inside an interpolation does not end it. Returns null when the literal never
 * closes, and the caller then skips the fragment rather than guessing.
 */
function readTemplate(text: string, openIndex: number): { body: string; end: number } | null {
  let i = openIndex + 1;
  let depth = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (depth === 0 && ch === '`') return { body: text.slice(openIndex + 1, i), end: i };
    if (ch === '$' && text[i + 1] === '{') {
      depth++;
      i += 2;
      continue;
    }
    if (depth > 0) {
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      else if (ch === '`') {
        // A nested template inside the interpolation. Skip it whole.
        const nested = readTemplate(text, i);
        if (!nested) return null;
        i = nested.end + 1;
        continue;
      }
    }
    i++;
  }
  return null;
}

/**
 * Scalar constants: `const DEFAULT_VISITS_REQUIRED = 10;`
 *
 * A fragment may embed a NUMBER rather than another fragment —
 * `lifecycle.repository.ts` builds its cycle arithmetic that way. Collecting
 * only template literals left four statements unrebuildable for the sake of one
 * integer. Strings are collected too, single or double quoted.
 *
 * The rule is narrow on purpose: a literal number or a quoted string, and
 * nothing else. An expression can change meaning after substitution.
 * A gate that reports an unknown is safer than a gate that assumes one.
 */
const SCALAR_DECL =
  /(?:const|let)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(\d+(?:\.\d+)?|'[^'\n]*'|"[^"\n]*")\s*[;\n]/g;

/** `import { A, B } from './x'` — the specifiers and the module path. */
const NAMED_IMPORT = /import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g;

/**
 * Every fragment a file can see: its own, then the ones it imports.
 *
 * A local declaration replaces an imported one, as JavaScript does. Without
 * that rule the gate rebuilds a statement the runtime never produces.
 *
 * An import resolves ONE level deep, and only for a relative path. One level is
 * what this codebase does: `auth.repository.ts` imports `PLATFORM_GRANT_CTE`
 * from `rbac.sql.ts`. A deeper walk adds cycle handling for little gain.
 * A package import is skipped. No dependency supplies a SQL fragment.
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
  TEMPLATE_DECL_HEAD.lastIndex = 0;
  for (let m = TEMPLATE_DECL_HEAD.exec(text); m; m = TEMPLATE_DECL_HEAD.exec(text)) {
    const open = TEMPLATE_DECL_HEAD.lastIndex - 1;
    const lit = readTemplate(text, open);
    // An unterminated literal is skipped, so the statement stays UNCOVERED.
    // Reporting it is honest; guessing at its content is not.
    if (!lit) continue;
    frags.set(m[1], lit.body);
    TEMPLATE_DECL_HEAD.lastIndex = lit.end + 1;
  }
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
 * The check stays narrow. Work item 18 step 2 asks that a literal must reach a
 * `query()` call. That rule is stricter and it is WRONG here: the dominant
 * pattern assigns SQL to a `const` and passes it elsewhere, so the rule would
 * hide most of the suite. The gate excludes known MESSAGE positions instead.
 */
export function looksLikeSql(body: string, precededBy = ''): boolean {
  if (!SQL_SHAPED.test(body)) return false;
  const tail = precededBy.slice(-80);
  // An argument to an error constructor, or to a logger, is a MESSAGE.
  if (/\bnew\s+(?:\w*Error|\w*Exception)\s*\(\s*$/.test(tail)) return false;
  if (/\bthrow\s+$/.test(tail)) return false;
  if (/\b(?:logger|log|console)\s*\.\s*\w+\s*\(\s*$/.test(tail)) return false;
  return true;
}

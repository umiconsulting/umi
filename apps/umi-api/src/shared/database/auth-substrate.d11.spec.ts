import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * D11 static assertion (SECURITY_GATE.md §4) — the auth substrate is NEVER
 * touched from an RLS request-path (app-pool) code path.
 *
 * The substrate — `runtime.{session,otp,password_reset_token,device_session,
 * pairing}` plus the credential columns `password_hash`/`password_salt` on
 * `umi.user` — is reachable only on the BYPASSRLS worker pool (`pg.query` /
 * `pg.workerTx`). `api`/`readonly` hold zero privilege on it (enforced by the
 * DB A-gate); this test enforces the *symmetric backend invariant* so a
 * regression is caught in CI at authoring time, not by a runtime "permission
 * denied".
 *
 * How: walk production source with the TypeScript compiler and fail if any
 * app-pool call site references the substrate. An app-pool call site is
 *   - `withTenant(cb)` / `runWithTenant(id, uid, cb)` — the pooled client is
 *     passed INTO the callback, so the callback's SQL is lexically inside the
 *     call node — or
 *   - a direct `.app.query(...)` / `.app.connect(...)`.
 * Only string- and template-literal text is scanned; comments and identifiers
 * (e.g. the camelCase `passwordHash` DTO field) are ignored, so the check keys
 * on real SQL, not prose.
 */

// Match the schema-qualified auth-substrate tables and the credential columns,
// tolerating double-quoted identifiers (`"runtime"."session"`, `runtime."session"`)
// and whitespace around the dot — the forms a hand-written query might take. The
// `(?![\w"])` / `(?<![\w"])` boundaries keep lookalikes out: `conversation_state`,
// a hypothetical `session_foo`, and the camelCase DTO field `passwordHash` (no
// underscore) never match.
const AUTH_SUBSTRATE: readonly RegExp[] = [
  /(?<![\w"])"?runtime"?\s*\.\s*"?(?:session|otp|password_reset_token|device_session|pairing)"?(?![\w"])/i,
  /(?<![\w"])"?(?:password_hash|password_salt)"?(?![\w"])/i,
];

const APP_POOL_METHODS = new Set(['withTenant', 'runWithTenant']);

const SRC = resolve(process.cwd(), 'src');

function productionTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...productionTsFiles(p));
      continue;
    }
    const n = entry.name;
    if (
      n.endsWith('.ts') &&
      !n.endsWith('.d.ts') &&
      !n.endsWith('.spec.ts') &&
      !n.endsWith('.test.ts') &&
      !n.endsWith('.integration.ts')
    ) {
      out.push(p);
    }
  }
  return out;
}

/** Concatenated text of every string / template literal lexically inside `node`. */
function sqlLiteralsWithin(node: ts.Node): string {
  const parts: string[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
      parts.push(n.text);
    } else if (ts.isTemplateExpression(n)) {
      parts.push(n.head.text, ...n.templateSpans.map((s) => s.literal.text));
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return parts.join('\n');
}

type AppPoolKind =
  | 'none'
  /** SQL lives in the call's own args — `withTenant(cb)` / `.app.query(sql)`. */
  | 'call'
  /** `.app.connect()` hands a client to the enclosing scope — scan that scope. */
  | 'connect';

/** Classify a call by how it reaches the RLS app pool (and where its SQL lives). */
function appPoolKind(call: ts.CallExpression): AppPoolKind {
  const callee = call.expression;
  if (!ts.isPropertyAccessExpression(callee)) return 'none';
  const name = callee.name.text;
  if (APP_POOL_METHODS.has(name)) return 'call';
  const onApp =
    ts.isPropertyAccessExpression(callee.expression) &&
    callee.expression.name.text === 'app';
  if (onApp && name === 'query') return 'call';
  if (onApp && name === 'connect') return 'connect';
  return 'none';
}

/**
 * The nearest function-like ancestor — the scope a `.app.connect()` client is
 * bound and used in. Sound over-approximation: a client obtained on the app pool
 * makes every SQL literal in its scope suspect, even when passed through a local
 * variable the args-only scan can't follow.
 */
function enclosingScope(node: ts.Node, sf: ts.SourceFile): ts.Node {
  let n = node.parent as ts.Node | undefined;
  while (n) {
    if (
      ts.isFunctionDeclaration(n) ||
      ts.isMethodDeclaration(n) ||
      ts.isFunctionExpression(n) ||
      ts.isArrowFunction(n) ||
      ts.isConstructorDeclaration(n)
    ) {
      return n;
    }
    n = n.parent as ts.Node | undefined;
  }
  return sf;
}

interface Violation {
  file: string;
  line: number;
  method: string;
  match: string;
}

const files = productionTsFiles(SRC);
const violations: Violation[] = [];
const seen = new Set<string>();
let appPoolSites = 0;

for (const file of files) {
  const sf = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
  );
  const walk = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const kind = appPoolKind(node);
      if (kind !== 'none') {
        appPoolSites += 1;
        const method = ts.isPropertyAccessExpression(node.expression)
          ? node.expression.name.text
          : '<app>';
        // For `.app.connect()` the SQL is elsewhere in the scope; scan the whole
        // enclosing function. For `withTenant`/`.app.query` it's in the call args.
        const scanNode = kind === 'connect' ? enclosingScope(node, sf) : node;
        const sql = sqlLiteralsWithin(scanNode);
        for (const rx of AUTH_SUBSTRATE) {
          const m = rx.exec(sql);
          if (m) {
            const { line } = sf.getLineAndCharacterOfPosition(
              scanNode.getStart(sf),
            );
            const rel = relative(process.cwd(), file);
            const key = `${rel}:${line}:${m[0]}`;
            if (!seen.has(key)) {
              seen.add(key);
              violations.push({ file: rel, line: line + 1, method, match: m[0] });
            }
          }
        }
      }
    }
    ts.forEachChild(node, walk);
  };
  walk(sf);
}

describe('D11 · auth substrate is off the app pool (static)', () => {
  it('the scanner found app-pool call sites (detection is not vacuous)', () => {
    expect(files.length).toBeGreaterThan(0);
    // withTenant/runWithTenant/.app usages exist across the repositories; if this
    // ever hits 0 the detection has silently broken and the invariant is unguarded.
    expect(appPoolSites).toBeGreaterThan(0);
  });

  it('no withTenant / runWithTenant / .app path references the auth substrate', () => {
    const report = violations
      .map((v) => `  ${v.file}:${v.line} (${v.method}) → "${v.match}"`)
      .join('\n');
    expect(
      violations,
      `Auth substrate touched on the RLS app pool — move it to the worker pool ` +
        `(pg.query / pg.workerTx). See SECURITY_GATE.md §4 D11.\n${report}`,
    ).toEqual([]);
  });
});

describe('D11 · AUTH_SUBSTRATE regexes', () => {
  const hits = (sql: string): boolean => AUTH_SUBSTRATE.some((rx) => rx.test(sql));

  it.each([
    'select token_hash from runtime.session',
    'insert into runtime.password_reset_token (user_id)',
    'delete from runtime.pairing where id = $1',
    'update umi.user set password_hash = $1, password_salt = $2',
    // quoted identifiers
    'from runtime."session"',
    'from "runtime"."session"',
    'from "runtime".session',
    // whitespace around the dot
    'from runtime . session',
  ])('flags the auth substrate: %s', (sql) => {
    expect(hits(sql)).toBe(true);
  });

  it.each([
    // lookalike tables that are NOT the substrate
    'from runtime.conversation_state',
    'from runtime.conversation',
    'from runtime.reminder_sent',
    // a hypothetical column/table that merely starts the same
    'from runtime.session_archive',
    // the camelCase DTO field (no underscore) — TS identifier, not SQL
    'const passwordHash = row.passwordHash;',
    // unrelated table on the app pool is fine
    'from tenant.customer where business_id = $1',
  ])('does not flag: %s', (sql) => {
    expect(hits(sql)).toBe(false);
  });
});

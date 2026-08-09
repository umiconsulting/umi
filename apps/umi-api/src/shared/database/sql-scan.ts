import { readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Shared scanner primitives for the two live-schema gates that read the backend's SQL
 * out of its own source: `sql-preflight` (does every NAME resolve?) and `check-values`
 * (is every compared VALUE one the schema admits?).
 *
 * This lives in a plain module rather than inside either gate because importing one
 * test file from another EXECUTES its suite — the check-value gate briefly re-ran the
 * whole preflight as a side effect of borrowing one function.
 */

/**
 * Blank out comments before the scanner looks for SQL, preserving every character
 * position so reported line numbers stay true.
 *
 * WHY. The scanner walks backtick-delimited spans over the raw file, and a doc comment
 * that QUOTES SQL contains backticks too. `kds.repository.ts` explains a rewrite with
 * "Replaces the old `SELECT kitchen_status FROM ops.orders FOR UPDATE`", and the gate
 * dutifully reported that as an unresolved statement against `ops.orders` — a table that
 * is *supposed* to be gone. The give-away was the extracted SQL carrying the comment's
 * own `*` continuation marker.
 *
 * This matters more than one bad row. P1's definition of done is "0 unresolved", and a
 * false positive makes that target unreachable except by deleting a correct explanatory
 * comment. A gate that cannot reach zero is a gate people learn to read past.
 *
 * The scanner tracks string state as well as comment state, so a `//` inside a URL or a
 * `/*` inside a SQL string is not mistaken for a comment.
 */
export function blankComments(text: string): string {
  const out = text.split('');
  type Mode = 'code' | 'line' | 'block' | 'squote' | 'dquote' | 'tick';
  let mode: Mode = 'code';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];
    if (mode === 'code') {
      if (c === '/' && next === '/') {
        mode = 'line';
        out[i] = ' ';
        out[i + 1] = ' ';
        i++;
      } else if (c === '/' && next === '*') {
        mode = 'block';
        out[i] = ' ';
        out[i + 1] = ' ';
        i++;
      } else if (c === "'") mode = 'squote';
      else if (c === '"') mode = 'dquote';
      else if (c === '`') mode = 'tick';
    } else if (mode === 'line') {
      if (c === '\n') mode = 'code';
      else out[i] = ' ';
    } else if (mode === 'block') {
      if (c === '*' && next === '/') {
        out[i] = ' ';
        out[i + 1] = ' ';
        i++;
        mode = 'code';
      } else if (c !== '\n') out[i] = ' ';
    } else {
      // Inside a string: only its own terminator ends it. Backslash escapes the next char.
      if (c === '\\') i++;
      else if (
        (mode === 'squote' && c === "'") ||
        (mode === 'dquote' && c === '"') ||
        (mode === 'tick' && c === '`')
      )
        mode = 'code';
    }
  }
  return out.join('');
}

/** Every backend source file a gate should read SQL out of. */
export function sourceFiles(root: string): string[] {
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

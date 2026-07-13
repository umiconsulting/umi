// sql-schema.mjs — ownership (Layer 4) from Postgres DDL.
// Sources: PostgreSQL docs — Foreign Keys (5.5.5), CREATE TABLE (ON DELETE),
// Transaction Isolation; DDD Aggregates (Evans/Vernon).
//
// Ownership rule (audit-refined): a foreign key with ON DELETE CASCADE where the
// parent is a DOMAIN table means the parent OWNS the child (aggregate part). A
// nullable FK / ON DELETE SET NULL / NO ACTION means the child merely REFERENCES
// an independent aggregate (a boundary). CASCADE to a MULTITENANCY root
// (core.tenants) is cleanup convention, NOT ownership — exclude it. A NOT NULL FK
// with NO ACTION/RESTRICT is a required reference, still not ownership.

import { readFileSync } from 'node:fs'

const ACTIONS = 'cascade|set\\s+null|set\\s+default|restrict|no\\s+action'

// Split SQL into statements, respecting '...', "...", $tag$...$tag$ and comments.
export function splitStatements(sql) {
  const out = []
  let cur = ''
  let i = 0
  const n = sql.length
  while (i < n) {
    const c = sql[i]
    // line comment
    if (c === '-' && sql[i + 1] === '-') { const j = sql.indexOf('\n', i); i = j === -1 ? n : j; continue }
    // block comment
    if (c === '/' && sql[i + 1] === '*') { const j = sql.indexOf('*/', i); i = j === -1 ? n : j + 2; continue }
    // single / double quotes
    if (c === "'" || c === '"') {
      const q = c; cur += c; i++
      while (i < n) { cur += sql[i]; if (sql[i] === q && sql[i - 1] !== '\\') { i++; break } i++ }
      continue
    }
    // dollar-quote $tag$ ... $tag$
    if (c === '$') {
      const m = /^\$[A-Za-z_0-9]*\$/.exec(sql.slice(i))
      if (m) {
        const tag = m[0]
        const end = sql.indexOf(tag, i + tag.length)
        const stop = end === -1 ? n : end + tag.length
        cur += sql.slice(i, stop); i = stop; continue
      }
    }
    if (c === ';') { out.push(cur); cur = ''; i++; continue }
    cur += c; i++
  }
  if (cur.trim()) out.push(cur)
  return out
}

// Postgres / Supabase system schemas — never application domain, always dropped.
export const SYSTEM_SCHEMAS = new Set([
  'pg_catalog', 'pg_toast', 'information_schema', 'auth', 'storage', 'realtime',
  'supabase_migrations', 'supabase_functions', 'extensions', 'graphql', 'graphql_public',
  'vault', 'pgbouncer', 'cron', 'net', '_realtime', '_analytics', 'pgsodium', 'pgsodium_masks',
])
const isSystem = (qualified) => SYSTEM_SCHEMAS.has(qualified.split('.')[0])

const norm = (t) => t.replace(/"/g, '').toLowerCase().trim()
const qualify = (t) => (norm(t).includes('.') ? norm(t) : 'public.' + norm(t))
const cleanAction = (a) => (a ? a.replace(/\s+/g, ' ').toLowerCase() : 'no action')

// Extract the balanced (...) body starting at/after position of first '('.
function parenBody(stmt) {
  const start = stmt.indexOf('(')
  if (start === -1) return null
  let depth = 0
  for (let i = start; i < stmt.length; i++) {
    if (stmt[i] === '(') depth++
    else if (stmt[i] === ')') { depth--; if (depth === 0) return stmt.slice(start + 1, i) }
  }
  return null
}

// Split a table body into top-level comma-separated column/constraint clauses.
function splitClauses(body) {
  const out = []
  let depth = 0, cur = ''
  for (const ch of body) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) { out.push(cur); cur = '' } else cur += ch
  }
  if (cur.trim()) out.push(cur)
  return out
}

export function parseSql(files) {
  const tables = new Map() // name -> { schema, name, columns:[], file }
  const fks = [] // { child, childCols, parent, action, notNull, file }
  const triggers = [] // { table, timing, events:[], fn, appendOnly }

  const reCreate = new RegExp('^\\s*create\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?([a-z_"][\\w.\"]*)', 'i')
  const reInlineRef = new RegExp('references\\s+([a-z_"][\\w.\"]*)\\s*(?:\\([^)]*\\))?', 'i')
  const reOnDelete = new RegExp('on\\s+delete\\s+(' + ACTIONS + ')', 'i')
  const reTableFk = new RegExp('foreign\\s+key\\s*\\(([^)]*)\\)\\s*references\\s+([a-z_"][\\w.\"]*)', 'i')
  const reAlterFk = new RegExp('alter\\s+table\\s+(?:only\\s+)?([a-z_"][\\w.\"]*)[\\s\\S]*?foreign\\s+key\\s*\\(([^)]*)\\)\\s*references\\s+([a-z_"][\\w.\"]*)', 'i')
  // Triggers are scanned GLOBALLY per file (not per split-statement): financial
  // ledgers attach append-only triggers inside a single guarded DO $$ ... $$
  // block, so multiple CREATE TRIGGERs live in one dollar-quoted statement.
  const reTriggerG = new RegExp('create\\s+(?:or\\s+replace\\s+)?(?:constraint\\s+)?trigger\\s+([\\w"]+)\\s+(before|after|instead\\s+of)\\s+([\\w\\s,]+?)\\s+on\\s+([a-z_"][\\w.\"]*)[\\s\\S]*?execute\\s+(?:function|procedure)\\s+([\\w.\"]+)', 'gi')

  for (const f of files) {
    if (f.lang !== 'sql') continue
    let sql
    try { sql = readFileSync(f.path, 'utf8') } catch { continue }
    // Global trigger scan (name-based append-only detection; also catches the
    // trigger whose NAME avoids 'append_only' by checking the executed function).
    for (const mt of sql.matchAll(reTriggerG)) {
      const tgname = norm(mt[1])
      const events = mt[3].split(/\s+or\s+|,/i).map((s) => s.trim().toLowerCase()).filter(Boolean)
      const fn = norm(mt[5])
      const appendOnly = /append_only|block_append|immutable/.test(tgname) ||
        /append_only|block_append|immutable|restrict_mutation|no_update|no_delete/.test(fn)
      triggers.push({ table: qualify(mt[4]), name: tgname, timing: mt[2].toLowerCase(), events, fn, appendOnly })
    }
    for (const stmt of splitStatements(sql)) {
      const mc = reCreate.exec(stmt)
      if (mc) {
        const full = qualify(mc[1])
        if (isSystem(full)) continue
        const [schema, name] = full.split('.')
        const body = parenBody(stmt) || ''
        const columns = []
        for (const clause of splitClauses(body)) {
          const c = clause.trim()
          // Blank string literals so a DEFAULT/CHECK value containing the text
          // "references … on delete cascade" can't produce a phantom FK.
          const cc = c.replace(/'[^']*'/g, "''")
          const low = cc.toLowerCase()
          // table-level FK constraint
          const tfk = reTableFk.exec(cc)
          if (/^\s*(constraint\s+[\w"]+\s+)?foreign\s+key/i.test(cc) && tfk) {
            const od = reOnDelete.exec(cc)
            fks.push({ child: full, childCols: tfk[1].split(',').map(norm), parent: qualify(tfk[2]),
                       action: cleanAction(od && od[1]), notNull: false, file: f.relPath })
            continue
          }
          if (/^\s*(primary\s+key|unique|check|constraint|exclude|like)/i.test(low)) continue
          // column definition
          const colName = norm(cc.split(/\s+/)[0] || '')
          if (!colName) continue
          columns.push(colName)
          const iref = reInlineRef.exec(cc)
          if (iref) {
            const od = reOnDelete.exec(cc)
            fks.push({ child: full, childCols: [colName], parent: qualify(iref[1]),
                       action: cleanAction(od && od[1]), notNull: /not\s+null/i.test(low), file: f.relPath })
          }
        }
        tables.set(full, { schema, name, columns, file: f.relPath })
        continue
      }
      // ALTER TABLE ... ADD FOREIGN KEY
      const ma = reAlterFk.exec(stmt)
      if (ma && /add\s+(constraint|foreign)/i.test(stmt)) {
        const od = reOnDelete.exec(stmt)
        fks.push({ child: qualify(ma[1]), childCols: ma[2].split(',').map(norm), parent: qualify(ma[3]),
                   action: cleanAction(od && od[1]), notNull: false, file: f.relPath })
        continue
      }
    }
  }
  return { tables, fks, triggers }
}

// Turn FKs into an ownership model. Returns:
//   ownsEdges: parent OWNS child (domain cascade)
//   refEdges:  child REFERENCES parent (association / boundary)
//   roots: [{table, ownedCount}] ranked aggregate-root candidates
//   appendOnly: Set(table)
export const MULTITENANCY_ROOTS = new Set(['core.tenants', 'public.tenants', 'platform.tenants'])
export const ATTRIBUTION = /(_by$|_by_|staff_member_id|created_by|updated_by|user_id$|actor)/
// Config / catalog / reference tables: a cascade FK to one of these is a
// reference to which config/type was used, not composition. When a child
// cascades from BOTH a real parent and a config table, the real parent owns it.
const CONFIG_RE = /(config|configs|catalog|catalogs|template|templates|_type|_types|setting|settings)$/

export function ownership({ tables, fks, triggers }) {
  const ownsEdges = [], refEdges = [], boundaryRefs = []
  const shortOf = (t) => t.split('.')[1] || t
  // Group cascade FKs by child so a table with multiple cascade parents is
  // resolved deterministically (not last-write-wins).
  const cascadeByChild = new Map()
  for (const fk of fks) {
    if (isSystem(fk.parent) || isSystem(fk.child)) continue
    if (MULTITENANCY_ROOTS.has(fk.parent)) { boundaryRefs.push({ ...fk, reason: 'multitenancy-root' }); continue }
    if (fk.parent === fk.child) continue // self-ref (tree) — not an ownership edge
    const attribution = fk.childCols.some((c) => ATTRIBUTION.test(c))
    if (fk.action === 'cascade' && !attribution) {
      if (!cascadeByChild.has(fk.child)) cascadeByChild.set(fk.child, [])
      cascadeByChild.get(fk.child).push(fk)
    } else {
      refEdges.push({ from: fk.child, to: fk.parent, action: fk.action, attribution, cols: fk.childCols, file: fk.file })
    }
  }
  const ownedCount = new Map()
  for (const [child, parents] of cascadeByChild) {
    const nonConfig = parents.filter((p) => !CONFIG_RE.test(shortOf(p.parent)))
    const candidates = (nonConfig.length ? nonConfig : parents).slice().sort((a, b) => a.parent.localeCompare(b.parent))
    const owner = candidates[0]
    ownsEdges.push({ owner: owner.parent, part: child, cols: owner.childCols, file: owner.file })
    ownedCount.set(owner.parent, (ownedCount.get(owner.parent) || 0) + 1)
    // Any other cascade parents (config tables, or a secondary owner) become
    // references, not ownership — a table has exactly one aggregate owner.
    for (const p of parents) {
      if (p === owner) continue
      refEdges.push({ from: child, to: p.parent, action: 'cascade', attribution: false, cols: p.childCols, file: p.file, reason: 'secondary-cascade-parent' })
    }
  }
  const roots = [...ownedCount.entries()]
    .map(([table, ownedCount]) => ({ table, ownedCount }))
    .sort((a, b) => b.ownedCount - a.ownedCount)
  const appendOnly = new Set(triggers.filter((t) => t.appendOnly).map((t) => t.table))
  return { ownsEdges, refEdges, boundaryRefs, roots, appendOnly }
}

// domain-classify.mjs — Layers 2,3,4,6,7 synthesized from the deterministic
// signals. Every heuristic here is a PRIOR, not an oracle; the audit was explicit
// that identity/service/kernel heuristics over-fire, so we require positive
// discriminators and label confidence. Sources: Evans/Vernon (DDD, aggregates,
// context map), Garcia-Molina & Salem (Sagas), Postgres FK/tx docs.

import { MULTITENANCY_ROOTS } from './sql-schema.mjs'

// Infra tables that are written by many surfaces by nature — never a domain
// Shared Kernel even when multiple apps touch them.
const INFRA_TABLES = new Set([...MULTITENANCY_ROOTS, 'core.users', 'public.users', 'core.sessions'])

const INTEGRATION_PKGS = [
  'twilio', 'stripe', 'nodemailer', 'resend', '@sendgrid', 'passkit', 'passkit-generator',
  '@anthropic-ai', 'openai', 'voyageai', '@zettle', 'zettle', 'google-auth-library', 'googleapis',
  '@supabase/supabase-js',
]
const TX_METHODS = ['withTenant', 'runWithTenant', 'workerTx', '$transaction', 'transaction']
const EXTERNAL_IO = /\b(fetch|axios|got|\.request\(|\.send\(|twilioClient|messages\.create|\.enqueue\(|\.add\(|passkit|sendMail|\.publish\()/i
const RE_INSERT = /insert\s+into\s+([a-z_][\w]*\.[a-z_][\w]*)/gi
const RE_UPDATE = /update\s+([a-z_][\w]*\.[a-z_][\w]*)\s+set/gi
const RE_DELETE = /delete\s+from\s+([a-z_][\w]*\.[a-z_][\w]*)/gi

export function classify(ctx) {
  return {
    modules: businessModules(ctx),
    roles: domainRoles(ctx),
    entities: entities(ctx),
    valueObjects: valueObjects(ctx),
    aggregates: aggregates(ctx),
    transactions: transactionBoundaries(ctx),
    contextMap: contextMap(ctx),
  }
}

// Layer 2 — business modules = module nodes, enriched with the NestJS feature
// name where available (the app's own componentization, not a folder guess).
function businessModules(ctx) {
  const byModule = new Map()
  for (const f of ctx.files) {
    if (f.lang !== 'js' && f.lang !== 'swift') continue
    if (!byModule.has(f.module)) byModule.set(f.module, { module: f.module, app: f.app, files: 0, nestModules: [] })
    byModule.get(f.module).files++
  }
  for (const [file, nest] of ctx.nestByFile) {
    for (const m of nest.modules) {
      const f = ctx.byRel.get(file)
      if (f && byModule.has(f.module)) byModule.get(f.module).nestModules.push(m.class)
    }
  }
  return [...byModule.values()].sort((a, b) => b.files - a.files)
}

// Layer 3 — roles by structural signal (repository/controller/service/adapter),
// with domain-vs-application service kept as a PRIOR (see audit).
function domainRoles(ctx) {
  const repositories = [], controllers = [], services = [], domainLogic = [], adapters = []
  for (const f of ctx.files) {
    if (f.lang !== 'js') continue
    const rel = f.relPath
    const base = rel.toLowerCase()
    if (/\.repository\.[cm]?[jt]sx?$/.test(base)) repositories.push(rel)
    if (/\.controller\.[cm]?[jt]sx?$/.test(base)) controllers.push(rel)
    if (/\.logic\.[cm]?[jt]sx?$/.test(base)) domainLogic.push(rel)
    if (/\.adapter\.[cm]?[jt]sx?$/.test(base) || /[\\/](adapters|integrations)[\\/]/.test(rel)) adapters.push(rel)
    else {
      // external-SDK-confined module = anti-corruption layer candidate
      const ext = ctx.externalsByFile.get(f.path)
      if (ext && [...ext].some((p) => INTEGRATION_PKGS.some((k) => p.startsWith(k)))) adapters.push(rel)
    }
    if (/\.service\.[cm]?[jt]sx?$/.test(base)) {
      const text = ctx.textOf(f.path)
      const injectsIO = /PgService|Repository|HttpService|PrismaClient|SupabaseClient|createClient/.test(text)
      services.push({ file: rel, prior: injectsIO ? 'application' : 'possibly-domain' })
    }
  }
  return {
    repositories, controllers, adapters: [...new Set(adapters)], domainLogic,
    services,
    note: 'service domain/application split is a prior, not a verdict — confirm domain services via *.logic.ts pure modules.',
  }
}

// Layer 3/4 — entities = tables with identity USED elsewhere (root, or referenced
// by id from another aggregate). Pure cascade-only children never referenced by
// id are aggregate-internal parts, not standalone entities. (Audit: PK+timestamps
// alone is too weak — near-universal audit columns.)
function entities(ctx) {
  const { ownsEdges, refEdges, roots, appendOnly } = ctx.sqlOwnership
  const rootSet = new Set(roots.map((r) => r.table))
  const referencedById = new Set(refEdges.map((e) => e.to))
  const ownedParts = new Set(ownsEdges.map((e) => e.part))
  const all = new Set([...ctx.sqlParsed.tables.keys()])
  const list = []
  for (const t of all) {
    const isRoot = rootSet.has(t)
    const referenced = referencedById.has(t)
    const ledger = appendOnly.has(t)
    if (isRoot || referenced) {
      list.push({ table: t, role: isRoot ? 'aggregate-root' : 'entity', referencedByIdentity: referenced, appendOnly: ledger })
    }
  }
  const internalParts = [...ownedParts].filter((p) => !rootSet.has(p) && !referencedById.has(p))
  return { entities: list.sort((a, b) => a.table.localeCompare(b.table)), aggregateInternalParts: internalParts }
}

// Layer 3 — value objects: Umi is primitive-obsessed, so surface the SEAMS
// (normalize/parse/format helpers, integer-cents money) rather than claiming
// first-class VOs (audit: drop the embedded-column-prefix signal).
function valueObjects(ctx) {
  const helpers = []
  for (const f of ctx.files) {
    if (f.lang !== 'js') continue
    if (!/[\\/](format|value|money|domain)[\\/]/.test(f.relPath) && !/money|phone|normaliz/i.test(f.relPath)) continue
    const text = ctx.textOf(f.path)
    for (const m of text.matchAll(/export\s+(?:const|function)\s+(normalize\w*|parse\w*|to\w*Cents|from\w*Cents|\w*Money\w*|format\w*)/gi)) {
      helpers.push({ file: f.relPath, name: m[1] })
    }
  }
  return {
    seamHelpers: helpers.slice(0, 40),
    note: 'VOs here are mostly primitive-obsession seams (integer-cents money, normalizePhone, ISO dates) — not first-class wrapper types.',
  }
}

// Layer 4 — aggregates from SQL cascade clusters. Report DIRECT ownership at each
// level (aggregates don't nest: programs owns accounts; accounts owns cards; the
// card owns its ledger — the card is the transactional root, per Vernon), rather
// than flattening the whole cascade chain to the topmost table.
function aggregates(ctx) {
  const { ownsEdges } = ctx.sqlOwnership
  const byOwner = new Map()
  for (const e of ownsEdges) {
    if (!byOwner.has(e.owner)) byOwner.set(e.owner, new Set())
    byOwner.get(e.owner).add(e.part)
  }
  return [...byOwner.entries()]
    .map(([root, parts]) => ({ root, parts: [...parts].sort(), repository: repoForTable(ctx, root) }))
    .sort((a, b) => b.parts.length - a.parts.length)
}

// Layer 6 — transaction boundaries: for each tx callback, which aggregate ROOTS
// get written? >1 distinct root (excluding outbox) = one-aggregate-per-transaction
// smell; external I/O inside the tx = move-to-outbox smell.
function transactionBoundaries(ctx) {
  const ownerOf = buildOwnerOf(ctx.sqlOwnership.ownsEdges)
  const ownerSet = new Set(ctx.sqlOwnership.ownsEdges.map((e) => e.owner))
  const haveOwnership = ownerSet.size > 0
  const txs = []
  for (const f of ctx.files) {
    if (f.lang !== 'js') continue
    if (f.test) continue
    const text = ctx.textOf(f.path)
    for (const method of TX_METHODS) {
      let from = 0
      while (true) {
        const idx = text.indexOf('.' + method + '(', from)
        if (idx === -1) break
        // Advance past this call; scan the callback body starting AFTER the '('
        // (idx points at '.', so '(' is at idx+method.length+1 → body starts +2).
        from = idx + method.length + 1
        const body = balancedArg(text, idx + method.length + 2)
        if (!body) continue
        const tables = new Set()
        for (const re of [RE_INSERT, RE_UPDATE, RE_DELETE]) {
          re.lastIndex = 0
          for (const m of body.matchAll(re)) tables.add(m[1].toLowerCase())
        }
        if (tables.size === 0) continue
        const roots = new Set()
        for (const t of tables) {
          if (t.startsWith('queue.')) continue // outbox is the allowed cross-agg write
          roots.add(nearestRoot(t, ownerOf, ownerSet))
        }
        const externalIO = EXTERNAL_IO.test(body)
        txs.push({
          file: f.relPath, method,
          tables: [...tables], roots: [...roots],
          externalIO,
          // Only a hotspot when we actually have an ownership model to collapse
          // roots against — otherwise every multi-table write looks like one.
          hotspot: haveOwnership && roots.size > 1,
        })
      }
    }
  }
  // Collapse identical findings (same file writing the same root-set) so one
  // repeated pattern isn't reported many times.
  const seen = new Set()
  const deduped = txs.filter((t) => {
    const key = t.file + '|' + [...t.roots].sort().join(',')
    if (seen.has(key)) return false
    seen.add(key); return true
  })
  return {
    transactions: deduped,
    hotspots: deduped.filter((t) => t.hotspot),
    externalIOInTx: deduped.filter((t) => t.externalIO),
    ownershipAvailable: haveOwnership,
    note: haveOwnership
      ? 'Blind spot: only SQL written literally inside the callback is seen — a transaction that calls a helper method which writes another aggregate (e.g. redeemGiftCard → applyWalletDelta) will be under-counted.'
      : 'No SQL ownership model was available (no authoritative DDL in scope), so multi-table transactions could NOT be collapsed to aggregate roots — hotspot findings are unreliable here.',
  }
}

// Layer 7 — context map: bounded contexts (apps + schemas) + relationships.
function contextMap(ctx) {
  const apps = [...new Set(ctx.files.map((f) => f.app))].filter((a) => a !== 'root')
  const schemas = [...new Set([...ctx.sqlParsed.tables.keys()].map((t) => t.split('.')[0]))]
  const relationships = []

  // Open Host Service: the app with the most controllers + a CORS allowlist.
  const ctrlByApp = new Map()
  for (const c of ctx.nestControllers) {
    const f = ctx.byRel.get(c.file)
    if (f) ctrlByApp.set(f.app, (ctrlByApp.get(f.app) || 0) + 1)
  }
  let host = null, hostN = 0
  for (const [a, n] of ctrlByApp) if (n > hostN) { host = a; hostN = n }
  const hasCors = ctx.files.some((f) => f.lang === 'js' && /CORS_ORIGINS/.test(ctx.textOf(f.path)))
  if (host && hostN >= 3) relationships.push({ type: 'Open Host Service', host, evidence: `${hostN} controllers${hasCors ? ' + CORS_ORIGINS allowlist' : ''}` })

  // Customer/Supplier & Conformist: downstream apps pointing at an upstream via
  // API base-url env. Adapter presence distinguishes ACL from Conformist.
  for (const f of ctx.files) {
    if (f.lang !== 'js') continue
    const text = ctx.textOf(f.path)
    if (/VITE_API_BASE|NEXT_PUBLIC_UMI_API_BASE|UMI_API_BASE|\bapiBase\b/.test(text) && f.app !== host && f.app !== 'root') {
      if (!relationships.some((r) => r.type === 'Customer/Supplier' && r.from === f.app)) {
        relationships.push({ type: 'Customer/Supplier', from: f.app, to: host, evidence: 'API base-url env → upstream' })
      }
    }
  }

  // Anti-corruption layers: integration adapters → external upstream systems.
  const externalSystems = new Set()
  for (const [, ext] of ctx.externalsByFile) {
    for (const p of ext) {
      const hit = INTEGRATION_PKGS.find((k) => p.startsWith(k))
      if (hit) externalSystems.add(hit)
    }
  }
  for (const s of externalSystems) relationships.push({ type: 'Anti-Corruption Layer', from: host || 'backend', to: s, evidence: 'external SDK confined to adapter' })

  // Shared Kernel: a domain table written by 2+ apps (dual-writer). We attribute
  // raw-SQL writes to their app; Prisma apps write via ORM (noted as a gap).
  // table -> app -> Set(files) that issue raw-SQL writes to it.
  const writers = new Map()
  for (const f of ctx.files) {
    if (f.lang !== 'js') continue
    const text = ctx.textOf(f.path)
    for (const re of [RE_INSERT, RE_UPDATE, RE_DELETE]) {
      re.lastIndex = 0
      for (const m of text.matchAll(re)) {
        const t = m[1].toLowerCase()
        if (!writers.has(t)) writers.set(t, new Map())
        const byApp = writers.get(t)
        if (!byApp.has(f.app)) byApp.set(f.app, new Set())
        byApp.get(f.app).add(f.relPath)
      }
    }
  }
  for (const [t, byApp] of writers) {
    if (byApp.size < 2 || INFRA_TABLES.has(t)) continue
    // Low confidence when any app's writes to this table come from a SINGLE file
    // — a lone legacy shim (e.g. a dead server.js) shouldn't manufacture a
    // dual-writer verdict. Prisma-based apps write via the ORM, not raw SQL, so
    // this only sees raw-SQL writers (a known under-count).
    const files = [...byApp.values()].flatMap((s) => [...s])
    const lowConfidence = [...byApp.values()].some((s) => s.size === 1)
    relationships.push({
      type: 'Shared Kernel', table: t, apps: [...byApp.keys()], confidence: lowConfidence ? 'low' : 'medium',
      evidence: `raw-SQL writes from ${files.length} file(s): ${files.slice(0, 3).join(', ')}${lowConfidence ? ' — includes a single-file writer (possible dead/legacy shim); Prisma writes not counted' : ''}`,
    })
  }

  // Published Language: DTO contracts + outbox payload schema.
  const dtoCount = ctx.files.filter((f) => /\.dto\.[cm]?[jt]sx?$/.test(f.relPath)).length
  const hasOutbox = [...ctx.sqlParsed.tables.keys()].some((t) => /outbox/.test(t))
  if (dtoCount || hasOutbox) relationships.push({ type: 'Published Language', evidence: `${dtoCount} DTO contract files${hasOutbox ? ' + outbox event payload schema' : ''}` })

  // Separate Ways: apps with no cross-app import edge and no integration edge.
  const linkedApps = new Set(relationships.flatMap((r) => [r.from, r.to, r.host].filter(Boolean)))
  const crossAppEdge = new Set()
  for (const e of ctx.fileEdges) {
    const a = ctx.byRel.get(e.from), b = ctx.byRel.get(e.to)
    if (a && b && a.app !== b.app) { crossAppEdge.add(a.app); crossAppEdge.add(b.app) }
  }
  const separate = apps.filter((a) => !linkedApps.has(a) && !crossAppEdge.has(a))
  if (separate.length) relationships.push({ type: 'Separate Ways', apps: separate, evidence: 'no cross-app import, no integration edge' })

  return { contexts: { apps, schemas }, relationships }
}

// ---- helpers ----
function buildOwnerOf(ownsEdges) {
  const m = new Map()
  for (const e of ownsEdges) m.set(e.part, e.owner)
  return m
}
function climbRoot(table, ownerOf, guard = new Set()) {
  let cur = table
  while (ownerOf.has(cur) && !guard.has(cur)) { guard.add(cur); cur = ownerOf.get(cur) }
  return cur
}
// The NEAREST aggregate root: climb until we reach a table that itself owns
// children (an aggregate root), consistent with the aggregates() section — so
// card + its ledger collapse to `card`, not to the topmost cascade ancestor.
function nearestRoot(table, ownerOf, ownerSet, guard = new Set()) {
  let cur = table
  while (!ownerSet.has(cur) && ownerOf.has(cur) && !guard.has(cur)) { guard.add(cur); cur = ownerOf.get(cur) }
  return cur
}
// Strict repo attribution: the repository file's base name (minus .repository)
// must equal the table's short name (singular/plural), not merely contain it —
// fuzzy substring matching mis-attributed (ordering-settings→orders).
function repoForTable(ctx, table) {
  const short = (table.split('.')[1] || '').toLowerCase()
  const cands = new Set([short, short.replace(/s$/, ''), short + 's', short.replace(/s$/, '') + 's'])
  for (const f of ctx.files) {
    if (f.lang !== 'js') continue
    const m = /([\w-]+)\.repository\.[cm]?[jt]sx?$/.exec(f.relPath)
    if (m && cands.has(m[1].replace(/-/g, '_'))) return f.relPath
  }
  return null
}
// From an opening '(' index, return the balanced substring up to the matching ')'
// (capped) — used to isolate a transaction callback body. String/template/comment
// aware so parens INSIDE SQL literals ('(pending)', count(*)) don't unbalance the
// scan and bleed into following code (which previously caused every tx in a file
// to report the union of all tables).
function balancedArg(text, openIdx, cap = 8000) {
  let depth = 1
  let i = openIdx
  const end = Math.min(text.length, openIdx + cap)
  while (i < end) {
    const c = text[i]
    if (c === "'" || c === '"' || c === '`') {
      const q = c; i++
      while (i < end) { if (text[i] === '\\') { i += 2; continue } if (text[i] === q) { i++; break } i++ }
      continue
    }
    if (c === '/' && text[i + 1] === '/') { const j = text.indexOf('\n', i); i = j === -1 ? end : j; continue }
    if (c === '/' && text[i + 1] === '*') { const j = text.indexOf('*/', i); i = j === -1 ? end : j + 2; continue }
    if (c === '(') depth++
    else if (c === ')') { depth--; if (depth === 0) return text.slice(openIdx, i) }
    i++
  }
  return text.slice(openIdx, end)
}

#!/usr/bin/env node
// cartograph.mjs — entry point. Builds the factual metadata graph of a repository
// (the "system catalog") and renders the 9-section architectural report.
//
// Usage:
//   node cartograph.mjs <repo-root> [--out <dir>] [--json] [--quiet]
//
// Deterministic-first and ZERO-INSTALL: uses only Node ≥18 + the `typescript`
// package already present in the target repo (resolved automatically). Emits
// catalog.json (machine artifact) + report.md (human report). Embeddings/LLM
// narration are a SEPARATE, optional step that reads catalog.json — this engine
// never needs them and never invents facts.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { walk } from './lib/walk.mjs'
import { loadTypescript, buildTsGraph } from './lib/ts-graph.mjs'
import { extractNest } from './adapters/nestjs.mjs'
import { parseSql, ownership } from './lib/sql-schema.mjs'
import { parsePrisma } from './lib/prisma-parse.mjs'
import { parseSwift } from './lib/swift-parse.mjs'
import { buildModuleGraph, tarjanSCC, johnsonCircuits, coupling, sdpViolations, betweenness } from './lib/graph.mjs'
import { classify } from './lib/domain-classify.mjs'
import { renderReport } from './lib/report.mjs'

function main() {
  const args = process.argv.slice(2)
  const root = resolve(args.find((a) => !a.startsWith('--')) || process.cwd())
  const outDir = argVal(args, '--out') || join(root, '.cartographer')
  const quiet = args.includes('--quiet')
  const log = (...m) => { if (!quiet) console.error(...m) }

  log(`[cartographer] scanning ${root}`)
  // Walk FIRST; only load TypeScript if there are JS/TS files to parse, so a
  // SQL-only / Swift-only / Prisma-only target (or subdirectory) still produces
  // its layers instead of crashing on a missing typescript package.
  const files = walk(root)
  const byLang = tally(files.map((f) => f.lang))
  const hasJs = files.some((f) => f.lang === 'js')
  log(`[cartographer] ${files.length} files`, byLang)

  let ts = null
  let tsg = { edges: [], externals: new Map(), externalsByFile: new Map(), unresolved: [], asts: new Map() }
  if (hasJs) {
    ts = loadTypescript(root)
    tsg = buildTsGraph(ts, files, root)
  } else {
    log('[cartographer] no JS/TS files — skipping import graph & NestJS layers')
  }

  // --- Layer 1/5: TS/JS/Deno import graph ---
  const nestByFile = new Map()
  const nestControllers = []
  let forwardRefs = []
  for (const f of files) {
    if (f.lang !== 'js' || !ts) continue
    const sf = tsg.asts.get(f.path)
    if (!sf) continue
    const nest = extractNest(ts, sf, f.relPath)
    if (nest.modules.length || nest.controllers.length || nest.providers.length) nestByFile.set(f.relPath, nest)
    nestControllers.push(...nest.controllers)
    forwardRefs.push(...nest.forwardRefs)
  }

  // --- module-level graph + metrics ---
  const mg = buildModuleGraph(files, tsg.edges)
  const sccsAll = tarjanSCC(mg.nodes, mg.adj)
  const cycles = sccsAll.filter((c) => c.length > 1 || (c.length === 1 && mg.adj.get(c[0]).has(c[0])))
    .map((nodes) => {
      const { circuits, truncated } = johnsonCircuits(nodes, mg.adj, JOHNSON_CAP)
      // A cycle whose members include a catch-all `:.` root bucket (loose files
      // under a code root) may be a rollup artifact rather than a real cyclic
      // dependency — flag it so the report can down-weight it.
      const rollupArtifact = nodes.some((n) => n.endsWith(':.'))
      return { nodes, circuits, truncated, rollupArtifact }
    })
  const couplingRows = coupling(mg.nodes, mg.adj)
  const sdp = sdpViolations(couplingRows, mg.adj)
  const central = betweenness(mg.nodes, mg.adj)
  // Dead = no incoming edge of ANY kind (value/type/test) and not an entrypoint.
  // (Using runtime-only Ca would falsely flag type-only-consumed modules.)
  const anyIncoming = new Set()
  for (const p of mg.pairs.values()) anyIncoming.add(p.to)
  // Framework-routed modules (Next.js App Router page/layout/route/…, Vercel api/)
  // are loaded by the framework, not imported — treat as entrypoints.
  const NEXT_ENTRY = /(^|[\\/])(page|layout|route|loading|error|template|default|not-found|middleware|instrumentation)\.[cm]?[jt]sx?$/
  const entrypointModules = new Set()
  for (const f of files) {
    if (f.lang !== 'js') continue
    if (NEXT_ENTRY.test(f.relPath) || /[\\/](pages|app)[\\/]/.test(f.relPath) || /[\\/]api[\\/]/.test(f.relPath)) {
      entrypointModules.add(f.module)
    }
  }
  const dead = couplingRows
    .filter((r) => !anyIncoming.has(r.node) && !isEntrypoint(r.node) && !entrypointModules.has(r.node))
    .map((r) => r.node)

  // --- Layer 4: ownership from SQL + Prisma ---
  // Domain ownership uses PRIMARY (authoritative) SQL only; dumps / migration
  // history / staging / compat shims are parsed but set aside so schema
  // generations aren't conflated.
  const sqlPrimaryFiles = files.filter((f) => !(f.lang === 'sql' && f.sqlRole === 'reference'))
  const referenceSqlCount = files.filter((f) => f.lang === 'sql' && f.sqlRole === 'reference').length
  const sqlParsed = parseSql(sqlPrimaryFiles)
  const sqlOwnership = ownership(sqlParsed)
  const prisma = parsePrisma(files)

  // --- Swift ---
  const swift = parseSwift(files)

  // --- classify (Layers 2,3,4,6,7) ---
  const byRel = new Map(files.map((f) => [f.relPath, f]))
  const byPath = new Map(files.map((f) => [f.path, f]))
  const textCache = new Map()
  const ctx = {
    files, byRel, byPath, fileEdges: tsg.edges,
    nestByFile, nestControllers,
    externalsByFile: tsg.externalsByFile,
    sqlParsed, sqlOwnership, prisma, swift,
    moduleGraph: mg, coupling: couplingRows,
    textOf: (p) => { if (!textCache.has(p)) { try { textCache.set(p, readFileSync(p, 'utf8')) } catch { textCache.set(p, '') } } return textCache.get(p) },
  }
  const cls = classify(ctx)

  // --- layering violations + boundary leaks (for report sections 5 & 9) ---
  const layering = detectLayering(ctx, cls)
  const boundaryLeaks = detectLeaks(ctx, cls)

  // --- assemble catalog ---
  const catalog = {
    meta: {
      root, rootName: basename(root),
      files: { total: files.length, byLang },
      sqlSources: { primary: byLang.sql - referenceSqlCount, reference: referenceSqlCount },
      caveats: referenceSqlCount
        ? [...CAVEATS, `${referenceSqlCount} reference/historical SQL files (dumps, migration history, staging, compat shims) were parsed but EXCLUDED from the domain ownership map to avoid conflating schema generations. Postgres/Supabase system schemas (auth, storage, realtime, …) are always excluded.`]
        : CAVEATS,
      generatedBy: 'repository-cartographer', tsVersion: ts ? ts.version : null,
    },
    modules: cls.modules,
    roles: cls.roles,
    entities: cls.entities,
    valueObjects: cls.valueObjects,
    aggregates: cls.aggregates,
    ownership: {
      ownsEdges: sqlOwnership.ownsEdges, refEdges: sqlOwnership.refEdges,
      roots: sqlOwnership.roots, appendOnly: [...sqlOwnership.appendOnly],
      prismaOwns: prisma.ownsEdges, prismaRefs: prisma.refEdges,
    },
    graph: {
      moduleCount: mg.nodes.length, edgeCount: [...mg.adj.values()].reduce((s, x) => s + x.size, 0),
      cycles, coupling: couplingRows, sdp,
      centrality: { betweenness: central, degree: couplingRows.map((r) => ({ node: r.node, in: r.ca, out: r.ce })) },
      dead, forwardRefs,
    },
    transactions: cls.transactions,
    contextMap: cls.contextMap,
    layering, boundaryLeaks,
    externals: [...tsg.externals.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count })),
    unresolved: tsg.unresolved,
    swift: { modulesImported: [...swift.modulesImported.entries()], typeCount: swift.typesByName.size, files: swift.perFile.length },
  }

  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, 'catalog.json'), JSON.stringify(catalog, null, 2))
  const report = renderReport(catalog)
  writeFileSync(join(outDir, 'report.md'), report)
  log(`[cartographer] wrote ${join(outDir, 'catalog.json')} and report.md`)
  if (args.includes('--json')) process.stdout.write(JSON.stringify(catalog, null, 2))
  else process.stdout.write(report)
}

const CAVEATS = [
  'Static import scan only: DI-container/token wiring, dynamic import(), and Deno remote-URL imports are invisible — a real runtime cycle can be missed and outbox/queue indirection understates real cross-boundary coupling.',
  'Type-only and test-only edges are excluded from cycle/coupling analysis so they cannot manufacture phantom cycles.',
  'DDD role/ownership/context-map labels are inferred PRIORS, not authoritative facts — treat as inferred architecture, confirm against the code.',
  'Swift/Prisma are parsed heuristically (regex / hand-rolled block scanner); Prisma delete semantics can diverge from the real DB (triggers, relationMode="prisma").',
]

// A module is an entrypoint (excluded from dead-module detection) if it is a
// bootstrap/root or a framework-routed surface (pages/screens/functions) the
// static graph can't see being loaded.
const JOHNSON_CAP = 200 // max elementary circuits enumerated per SCC (see graph.mjs)
// Route groups `(name)`, `api`, and common bootstrap/route dirs are entrypoints.
const ENTRY = /(^|:)(\.|app|main|worker|index|bootstrap|server|pages|screens|routes|functions|middleware|components|api|\()/
function isEntrypoint(node) { return ENTRY.test(node) }

function detectLayering(ctx, cls) {
  const out = []
  const DB_PKGS = ['pg', 'postgres', 'mysql', 'mysql2', 'knex', 'better-sqlite3']
  // Which app hosts the backend/persistence? The one with repositories.
  const backendApps = new Set(cls.roles.repositories.map((r) => ctx.byRel.get(r)?.app).filter(Boolean))
  for (const [path, ext] of ctx.externalsByFile) {
    const f = ctx.byPath.get(path)
    if (!f) continue
    if ([...ext].some((p) => DB_PKGS.includes(p)) && !backendApps.has(f.app) && f.app !== 'root') {
      out.push({ from: f.module, detail: `${f.relPath} imports a raw DB driver` })
    }
  }
  return dedupeBy(out, (v) => v.from + v.detail).slice(0, 12)
}

function detectLeaks(ctx, cls) {
  const leaks = []
  const parts = new Set(cls.entities.aggregateInternalParts.map((t) => t.split('.')[1]))
  for (const c of ctx.nestControllers) {
    const p = c.prefix || ''
    for (const part of parts) {
      if (part && p.toLowerCase().includes(part.replace(/_/g, '-')) ) {
        leaks.push(`Controller \`${c.class}\` exposes routes for aggregate-internal table \`${part}\` — access should go through its aggregate root`)
      }
    }
  }
  return [...new Set(leaks)].slice(0, 10)
}

function argVal(args, flag) { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null }
function tally(arr) { const m = {}; for (const x of arr) m[x] = (m[x] || 0) + 1; return m }
function dedupeBy(arr, keyFn) { const seen = new Set(); return arr.filter((x) => { const k = keyFn(x); if (seen.has(k)) return false; seen.add(k); return true }) }

main()

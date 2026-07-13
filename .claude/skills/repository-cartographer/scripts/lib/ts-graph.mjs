// ts-graph.mjs — deterministic import/export graph for TS/JS/TSX and Deno files,
// using ONLY the bundled TypeScript Compiler API (no madge/ts-morph/dep-cruiser).
//
// Sources: TypeScript "Using the Compiler API" (microsoft/TypeScript wiki);
// Handbook Module Resolution; Deno Modules + import maps (docs.deno.com);
// WICG Import Maps standard.
//
// The audit was emphatic: classify EDGE KIND (value / type-only / test-only /
// dynamic) BEFORE any cycle verdict — type-only imports create phantom cycles
// and static scans miss DI/dynamic/remote edges. Every edge here carries
// typeOnly / dynamic / test flags so the graph layer can filter soundly.

import { createRequire } from 'node:module'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve, join, extname } from 'node:path'
import { discoverTsconfigs } from './walk.mjs'

// Resolve the `typescript` package from wherever the TARGET repo has it
// (root, any apps/*, or this skill's own runtime), so the engine stays
// zero-install for the user.
export function loadTypescript(root, extraDirs = []) {
  const candidates = [
    root, join(root, 'apps', 'umi-api'), ...extraDirs,
    ...safeApps(root), import.meta.dirname, process.cwd(),
  ]
  for (const base of candidates) {
    try {
      const req = createRequire(join(base, 'noop.js'))
      return req('typescript')
    } catch { /* try next */ }
  }
  throw new Error(
    'Could not resolve the "typescript" package. Run the cartographer from a repo ' +
    'that has typescript installed (any node_modules), or `npm i -D typescript`.'
  )
}

function safeApps(root) {
  const out = []
  try {
    const appsDir = join(root, 'apps')
    for (const e of readdirSync(appsDir, { withFileTypes: true })) {
      if (e.isDirectory()) out.push(join(appsDir, e.name))
    }
  } catch { /* no apps dir */ }
  return out
}

const RESOLVE_EXT = ['.ts', '.tsx', '.mts', '.cts', '.d.ts', '.js', '.jsx', '.mjs', '.cjs']

function scriptKind(ts, path) {
  const ext = extname(path).toLowerCase()
  if (ext === '.tsx' || ext === '.jsx') return ts.ScriptKind.TSX
  if (ext === '.js' || ext === '.mjs' || ext === '.cjs') return ts.ScriptKind.JS
  if (ext === '.json') return ts.ScriptKind.JSON
  return ts.ScriptKind.TS
}

// Extract raw import records from one source file's AST.
export function extractImports(ts, path, text) {
  const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, scriptKind(ts, path))
  const recs = []
  const push = (spec, o = {}) => { if (spec) recs.push({ spec, typeOnly: !!o.typeOnly, dynamic: !!o.dynamic }) }

  function visit(node) {
    // import ... from 'x'  /  import 'x'
    if (ts.isImportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const typeOnly = !!(node.importClause && node.importClause.isTypeOnly)
      push(node.moduleSpecifier.text, { typeOnly })
    }
    // export ... from 'x' (re-export)
    else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      push(node.moduleSpecifier.text, { typeOnly: !!node.isTypeOnly })
    }
    // import x = require('x')
    else if (ts.isImportEqualsDeclaration(node) && node.moduleReference &&
             ts.isExternalModuleReference(node.moduleReference) &&
             node.moduleReference.expression && ts.isStringLiteral(node.moduleReference.expression)) {
      push(node.moduleReference.expression.text)
    }
    else if (ts.isCallExpression(node)) {
      // dynamic import('x')
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const a = node.arguments[0]
        if (a && ts.isStringLiteral(a)) push(a.text, { dynamic: true })
        else push('<dynamic>', { dynamic: true }) // non-literal → unresolved
      }
      // require('x')  (syntactic — may false-positive on shadowed require)
      else if (ts.isIdentifier(node.expression) && node.expression.text === 'require') {
        const a = node.arguments[0]
        if (a && ts.isStringLiteral(a)) push(a.text)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return { sf, recs }
}

// Bucket a specifier and, when local, resolve it to an absolute file in fileSet.
export function resolveSpecifier(spec, fromFile, ctx) {
  if (spec === '<dynamic>') return { kind: 'dynamic-unresolved' }
  // URL / registry / builtin schemes (Deno remote, npm:, jsr:, node:)
  if (/^(https?|file):\/\//.test(spec)) return { kind: 'remote', name: spec }
  if (/^(npm|jsr|node):/.test(spec)) return { kind: 'registry', name: spec }

  // Relative
  if (spec.startsWith('./') || spec.startsWith('../')) {
    const base = resolve(dirname(fromFile), spec)
    const hit = tryFile(base, ctx.fileSet, ctx.deno)
    return hit ? { kind: 'internal', target: hit } : { kind: 'unresolved-relative', name: spec }
  }
  // tsconfig path alias (@/* etc.) for the app owning fromFile
  const aliasHit = resolveAlias(spec, fromFile, ctx)
  if (aliasHit) return { kind: 'internal', target: aliasHit }

  // Otherwise a bare package specifier → external dependency (not a repo edge)
  return { kind: 'external', name: pkgName(spec) }
}

function pkgName(spec) {
  const parts = spec.split('/')
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
}

function tryFile(base, fileSet, deno) {
  // Deno requires explicit extensions; still fall back for robustness.
  if (fileSet.has(base)) return base
  for (const e of RESOLVE_EXT) { if (fileSet.has(base + e)) return base + e }
  for (const e of RESOLVE_EXT) { const idx = join(base, 'index' + e); if (fileSet.has(idx)) return idx }
  return null
}

function resolveAlias(spec, fromFile, ctx) {
  // Find the nearest tsconfig (by longest app-dir prefix) that owns fromFile.
  let best = null
  for (const base of Object.keys(ctx.tsconfigs)) {
    if (fromFile.startsWith(base + '/') && (!best || base.length > best.length)) best = base
  }
  if (!best) return null
  const cfg = ctx.tsconfigs[best]
  const paths = cfg.paths || {}
  for (const pattern of Object.keys(paths)) {
    const star = pattern.indexOf('*')
    if (star === -1) {
      if (pattern === spec) {
        for (const t of paths[pattern]) { const hit = tryFile(resolve(cfg.baseUrl, t), ctx.fileSet, ctx.deno); if (hit) return hit }
      }
      continue
    }
    const prefix = pattern.slice(0, star)
    const suffix = pattern.slice(star + 1)
    if (spec.startsWith(prefix) && spec.endsWith(suffix)) {
      const mid = spec.slice(prefix.length, spec.length - suffix.length)
      for (const t of paths[pattern]) {
        const target = resolve(cfg.baseUrl, t.replace('*', mid))
        const hit = tryFile(target, ctx.fileSet, ctx.deno)
        if (hit) return hit
      }
    }
  }
  return null
}

// Build the full file-level graph. Returns { edges, externals, unresolved, asts }.
// edges: [{ from, to, typeOnly, dynamic, test }]  (from/to are relPaths)
export function buildTsGraph(ts, files, root) {
  const jsFiles = files.filter((f) => f.lang === 'js')
  const fileSet = new Set(jsFiles.map((f) => f.path))
  const byPath = new Map(files.map((f) => [f.path, f]))
  const tsconfigs = discoverTsconfigs(root, ts)
  const edges = []
  const externals = new Map() // pkg -> count
  const externalsByFile = new Map() // absPath -> Set(pkg)
  const unresolved = []
  const asts = new Map()

  for (const f of jsFiles) {
    let text
    try { text = readFileSync(f.path, 'utf8') } catch { continue }
    const { sf, recs } = extractImports(ts, f.path, text)
    asts.set(f.path, sf)
    const ctx = { fileSet, tsconfigs, deno: f.deno }
    for (const r of recs) {
      const res = resolveSpecifier(r.spec, f.path, ctx)
      if (res.kind === 'internal') {
        const to = byPath.get(res.target)
        if (to) edges.push({ from: f.relPath, to: to.relPath, typeOnly: r.typeOnly, dynamic: r.dynamic, test: f.test })
      } else if (res.kind === 'external' || res.kind === 'registry' || res.kind === 'remote') {
        externals.set(res.name, (externals.get(res.name) || 0) + 1)
        if (!externalsByFile.has(f.path)) externalsByFile.set(f.path, new Set())
        externalsByFile.get(f.path).add(res.name)
      } else if (res.kind.startsWith('unresolved') || res.kind === 'dynamic-unresolved') {
        unresolved.push({ from: f.relPath, spec: r.spec, kind: res.kind })
      }
    }
  }
  return { edges, externals, externalsByFile, unresolved, asts, tsconfigs }
}

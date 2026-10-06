// walk.mjs — file discovery + language classification + module rollup.
// The cartographer NEVER trusts directory names for meaning (utils/common/shared
// are treated as ordinary dirs); walk only records where files are and what
// language they are. Meaning is inferred later from import/SQL/decorator signals.

import { readdirSync, statSync, existsSync, readFileSync } from 'node:fs'
import { join, relative, sep, extname, basename } from 'node:path'

// Directories that never contain first-party source worth mapping.
const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.hg', '.svn', 'dist', '.next',
  '.turbo', '.vercel', '.expo', 'coverage', '.nyc_output', '.cache',
  'DerivedData', '.build', 'Pods', '.gradle', '__pycache__', '.venv',
  'vendor', 'tmp', '.idea', '.vscode', 'backups', 'artifacts',
])
// Ambiguous names: they mean "build output" ONLY when they sit at a package root
// (parent has package.json). Elsewhere (e.g. docs/migration/build/*.sql) they are
// legitimate source and must NOT be skipped — a bare-name ignore silently drops
// canonical DDL, which the cartographer depends on for the ownership layer.
const AMBIGUOUS_BUILD = new Set(['build', 'out'])
// Directory name prefixes to ignore (data dumps / handoffs).
const IGNORE_DIR_PREFIXES = ['prod-db-handoff', 'backup-', 'archive']
// Files that are stale copies / generated artifacts, not live source.
const IGNORE_FILE = (name) =>
  name.endsWith('.bak') || name.endsWith('.dump') || name.endsWith('.min.js') ||
  name.endsWith('.map') || name.endsWith('.d.ts.map') || name.includes('.pre-remap') ||
  /\.cash-bak$/.test(name) || name === '.DS_Store'

const JS_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.cts', '.mts'])

export function langOf(path) {
  const ext = extname(path).toLowerCase()
  if (ext === '.swift') return 'swift'
  if (ext === '.sql') return 'sql'
  if (ext === '.prisma') return 'prisma'
  if (JS_EXT.has(ext)) return 'js'
  return null
}

// A file is a Deno unit if it lives under a supabase/functions tree (Supabase
// edge functions) — same TS parser, different module-resolution rules.
export function isDeno(relPath) {
  return /(^|[\\/])supabase[\\/]functions[\\/]/.test(relPath)
}

// SQL that is a dump / replay history / staging / compat shim rather than the
// authoritative current schema. Excluded from the DOMAIN ownership map by default
// (still counted) so 5 schema generations don't get conflated into one graph.
export function isReferenceSql(relPath) {
  return /(audit-output|prod-schema|[-_]schema\.sql$|\/archive\/|\.dump$|\/(supabase|prisma)\/migrations\/|\/local-postgres\/|backfill|cleanup|synthetic|staging|compat)/i.test(relPath)
}

export function isTestFile(relPath) {
  const b = basename(relPath)
  return /\.(spec|test)\.[cm]?[jt]sx?$/.test(b) ||
    /(^|[\\/])(__tests__|__mocks__|test|tests)[\\/]/.test(relPath)
}

// Which apps/<name> (or "root") owns a file — the coarse bounded-context axis.
export function appOf(relPath) {
  const parts = relPath.split(/[\\/]/)
  if (parts[0] === 'apps' && parts[1]) return `apps/${parts[1]}`
  return 'root'
}

// Roll a file up to a "module" (Martin's component unit — the architecturally
// meaningful node). We strip a code-root segment then take 1-2 segments, going
// one deeper for container dirs that group many modules.
const CODE_ROOTS = new Set(['src', 'app', 'lib', 'Sources', 'source', 'sources'])
const GROUP_DIRS = new Set([
  'modules', 'shared', 'features', 'screens', 'components', 'jobs',
  'functions', 'services', 'domain', 'pages', 'routes', 'store', 'context',
])

export function moduleOf(relPath) {
  const app = appOf(relPath)
  let rest = relPath
  if (app !== 'root') rest = relPath.split(/[\\/]/).slice(2).join('/')
  let segs = rest.split(/[\\/]/).filter(Boolean)
  segs = segs.slice(0, -1) // drop filename
  // strip leading wrapper segments (code roots + the supabase project dir) so a
  // Supabase edge function surfaces as `functions/<fn>` (not one `supabase` blob).
  while (segs.length && (CODE_ROOTS.has(segs[0]) || segs[0] === 'supabase')) segs = segs.slice(1)
  let mod
  if (segs.length === 0) mod = '.'
  else if (GROUP_DIRS.has(segs[0]) && segs[1]) mod = `${segs[0]}/${segs[1]}`
  else mod = segs[0]
  return `${app}:${mod}`
}

export function walk(root) {
  const files = []
  const stack = [root]
  while (stack.length) {
    const dir = stack.pop()
    let entries
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { continue }
    for (const e of entries) {
      const full = join(dir, e.name)
      if (e.isDirectory()) {
        // Hidden dirs (.git, .github, .claude, .agents, .husky, …) are tooling,
        // never product source.
        if (e.name.startsWith('.')) continue
        if (IGNORE_DIRS.has(e.name)) continue
        if (IGNORE_DIR_PREFIXES.some((p) => e.name.startsWith(p))) continue
        if (AMBIGUOUS_BUILD.has(e.name) && existsSync(join(dir, 'package.json'))) continue
        stack.push(full)
      } else if (e.isFile()) {
        if (IGNORE_FILE(e.name)) continue
        const lang = langOf(e.name)
        if (!lang) continue
        const relPath = relative(root, full)
        files.push({
          path: full,
          relPath,
          lang,
          app: appOf(relPath),
          module: moduleOf(relPath),
          deno: lang === 'js' && isDeno(relPath),
          test: isTestFile(relPath),
          sqlRole: lang === 'sql' ? (isReferenceSql(relPath) ? 'reference' : 'primary') : null,
        })
      }
    }
  }
  return files
}

// Discover per-app tsconfig "paths"/"baseUrl" so alias imports (@/*) resolve.
// Returns { <appDir>: { baseUrl, paths } } keyed by absolute app dir.
export function discoverTsconfigs(root, ts) {
  const configs = {}
  const appsDir = join(root, 'apps')
  const roots = [root]
  if (existsSync(appsDir)) {
    for (const e of readdirSync(appsDir, { withFileTypes: true })) {
      if (e.isDirectory()) roots.push(join(appsDir, e.name))
    }
  }
  for (const base of roots) {
    const cfgPath = join(base, 'tsconfig.json')
    if (!existsSync(cfgPath)) continue
    try {
      const raw = ts.readConfigFile(cfgPath, (p) => readFileSync(p, 'utf8'))
      const parsed = ts.parseJsonConfigFileContent(raw.config || {}, ts.sys, base)
      configs[base] = {
        baseUrl: parsed.options.baseUrl || base,
        paths: parsed.options.paths || {},
      }
    } catch { /* tolerate malformed tsconfig */ }
  }
  return configs
}

// swift-parse.mjs — best-effort Swift structure via regex (no Swift compiler in a
// Node toolchain). Sources: The Swift Programming Language — Declarations
// (import grammar + type declarations); swiftlang/swift docs/Modules.md.
//
// Known unsoundness (report it, don't hide it): regex has no lexer, so it can be
// fooled by `import`/`class` inside strings, #if conditional compilation, and
// macros; `class` also appears as a member modifier (class func) and constraint
// (: class). We anchor patterns at header position and strip comments to reduce
// false positives, and we only emit file→module and file→declared-type edges —
// never symbol→module attribution (impossible without the compiler).

import { readFileSync } from 'node:fs'

const RE_IMPORT = /^\s*(?:@[\w()]+\s+)*import\s+(?:typealias|struct|class|enum|protocol|let|var|func\s+)?([A-Za-z_][\w.]*)/
const RE_DECL = /^\s*(?:(?:public|internal|private|fileprivate|open|final|indirect|dynamic|@[\w()]+)\s+)*(struct|class|actor|enum|protocol|extension)\s+([A-Za-z_]\w*)/

function stripCommentsAndStrings(text) {
  let out = ''
  let i = 0
  const n = text.length
  while (i < n) {
    const c = text[i]
    if (c === '/' && text[i + 1] === '/') { const j = text.indexOf('\n', i); i = j === -1 ? n : j; continue }
    if (c === '/' && text[i + 1] === '*') { const j = text.indexOf('*/', i); i = j === -1 ? n : j + 2; out += ' '; continue }
    if (c === '"') {
      // handle triple-quoted and normal strings; blank them but keep newlines
      if (text.slice(i, i + 3) === '"""') { const j = text.indexOf('"""', i + 3); i = j === -1 ? n : j + 3; out += '""'; continue }
      i++; while (i < n && text[i] !== '"') { if (text[i] === '\\') i++; i++ } i++; out += '""'; continue
    }
    out += c; i++
  }
  return out
}

export function parseSwift(files) {
  const perFile = []
  const modulesImported = new Map()
  const typesByName = new Map()
  for (const f of files) {
    if (f.lang !== 'swift') continue
    let text
    try { text = readFileSync(f.path, 'utf8') } catch { continue }
    text = stripCommentsAndStrings(text)
    const imports = new Set()
    const decls = []
    let depth = 0
    const depthStack = []
    for (const rawLine of text.split('\n')) {
      const line = rawLine
      const mi = RE_IMPORT.exec(line)
      if (mi) {
        const mod = mi[1].split('.')[0]
        imports.add(mod)
        modulesImported.set(mod, (modulesImported.get(mod) || 0) + 1)
      }
      const md = RE_DECL.exec(line)
      if (md && !/\bclass\s+(func|var|let)\b/.test(line)) {
        const kind = md[1], name = md[2]
        const parent = depthStack.length ? depthStack[depthStack.length - 1] : null
        decls.push({ kind, name, parent, depth })
        typesByName.set(name, (typesByName.get(name) || 0) + 1)
      }
      // brace-depth tracking (approximate; strings/comments already removed)
      const opens = (line.match(/\{/g) || []).length
      const closes = (line.match(/\}/g) || []).length
      if (md && opens > 0) depthStack.push(md[2])
      depth += opens - closes
      for (let k = 0; k < closes; k++) if (depthStack.length && depth < depthStack.length) depthStack.pop()
    }
    perFile.push({ file: f.relPath, app: f.app, module: f.module, imports: [...imports], decls })
  }
  return { perFile, modulesImported, typesByName }
}

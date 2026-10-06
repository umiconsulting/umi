// nestjs.mjs — NestJS structure extraction from a TS AST (TypeScript 5 API).
// Sources: NestJS docs — Modules, Providers/Controllers, Custom providers,
// Dynamic modules.
//
// Nest DI is a runtime container: the static @Module graph is EXACT for
// statically-declared modules and inherently PARTIAL for dynamic modules
// (forRoot/forFeature), useFactory values, spreads, @Global availability, and
// string/symbol token lookups. We record what is statically visible and flag
// the rest (dynamic:true / global:true) so downstream layers don't emit false
// "missing"/"unused"/cycle findings. forwardRef() sites are surfaced as
// developer-acknowledged cycles.

function decoratorName(ts, d) {
  const e = d.expression
  if (ts.isCallExpression(e) && ts.isIdentifier(e.expression)) return e.expression.text
  if (ts.isIdentifier(e)) return e.text
  return null
}

function getDecorators(ts, node) {
  if (ts.canHaveDecorators && !ts.canHaveDecorators(node)) return []
  return (ts.getDecorators && ts.getDecorators(node)) || node.decorators || []
}

function arrayIdentifiers(ts, expr, out) {
  // Collect names from an array literal of the form [A, B, forwardRef(()=>C), {provide,...}]
  if (!expr || !ts.isArrayLiteralExpression(expr)) return { dynamic: true }
  let dynamic = false
  for (const el of expr.elements) {
    if (ts.isIdentifier(el)) out.names.push(el.text)
    else if (ts.isCallExpression(el)) {
      if (ts.isIdentifier(el.expression) && el.expression.text === 'forwardRef') {
        const inner = forwardRefTarget(ts, el)
        if (inner) { out.names.push(inner); out.forwardRefs.push(inner) }
        else dynamic = true
      } else dynamic = true // forRoot()/forFeature()/computed
    } else if (ts.isObjectLiteralExpression(el)) {
      const prov = readProvider(ts, el)
      if (prov) out.providers.push(prov)
    } else if (ts.isSpreadElement(el)) dynamic = true
  }
  return { dynamic }
}

function forwardRefTarget(ts, call) {
  const a = call.arguments[0]
  if (a && ts.isArrowFunction(a) && ts.isIdentifier(a.body)) return a.body.text
  return null
}

function readProvider(ts, obj) {
  const prov = { provide: null, use: null }
  for (const p of obj.properties) {
    if (!ts.isPropertyAssignment(p) || !p.name) continue
    const key = p.name.getText ? p.name.getText() : (p.name.text || '')
    if (key === 'provide') prov.provide = p.initializer.getText ? p.initializer.getText() : null
    if (['useClass', 'useValue', 'useFactory', 'useExisting'].includes(key)) prov.use = key
  }
  return prov.provide || prov.use ? prov : null
}

function readModuleMeta(ts, callExpr) {
  const meta = { imports: { names: [], providers: [], forwardRefs: [], dynamic: false },
                 controllers: { names: [], providers: [], forwardRefs: [] },
                 providers: { names: [], providers: [], forwardRefs: [], dynamic: false },
                 exports: { names: [], providers: [], forwardRefs: [] } }
  const arg = callExpr.arguments[0]
  if (!arg || !ts.isObjectLiteralExpression(arg)) return meta
  for (const p of arg.properties) {
    if (!ts.isPropertyAssignment(p) || !p.name) continue
    const key = p.name.getText ? p.name.getText() : p.name.text
    if (!meta[key]) continue
    const r = arrayIdentifiers(ts, p.initializer, meta[key])
    if (r.dynamic) meta[key].dynamic = true
  }
  return meta
}

function ctorDeps(ts, node) {
  const deps = []
  const ctor = node.members && node.members.find((m) => ts.isConstructorDeclaration(m))
  if (!ctor) return deps
  for (const param of ctor.parameters) {
    let injectToken = null
    for (const d of getDecorators(ts, param)) {
      if (decoratorName(ts, d) === 'Inject') {
        const e = d.expression
        if (ts.isCallExpression(e) && e.arguments[0]) injectToken = e.arguments[0].getText()
      }
    }
    let typeName = null
    if (param.type && ts.isTypeReferenceNode(param.type) && ts.isIdentifier(param.type.typeName)) {
      typeName = param.type.typeName.text
    }
    if (typeName || injectToken) deps.push({ type: typeName, token: injectToken })
  }
  return deps
}

function routePrefix(ts, callExpr) {
  const a = callExpr.arguments[0]
  if (a && ts.isStringLiteral(a)) return a.text
  if (a && ts.isObjectLiteralExpression(a)) return '<obj>'
  return ''
}

const HTTP = new Set(['Get', 'Post', 'Put', 'Patch', 'Delete', 'Options', 'Head', 'All'])

// Returns per-file Nest info: { modules, controllers, providers } with details.
export function extractNest(ts, sf, relPath) {
  const out = { modules: [], controllers: [], providers: [], forwardRefs: [], global: false }
  function visit(node) {
    if (ts.isClassDeclaration(node) && node.name) {
      const className = node.name.text
      let isGlobal = false
      for (const d of getDecorators(ts, node)) {
        const name = decoratorName(ts, d)
        if (name === 'Global') { isGlobal = true; out.global = true }
      }
      for (const d of getDecorators(ts, node)) {
        const name = decoratorName(ts, d)
        const e = d.expression
        if (name === 'Module' && ts.isCallExpression(e)) {
          const meta = readModuleMeta(ts, e)
          out.modules.push({ class: className, file: relPath, global: isGlobal, meta })
          out.forwardRefs.push(...meta.imports.forwardRefs.map((t) => ({ from: className, to: t, site: 'module-imports' })))
        } else if (name === 'Controller' && ts.isCallExpression(e)) {
          const prefix = routePrefix(ts, e)
          const routes = []
          for (const m of node.members || []) {
            if (!ts.isMethodDeclaration(m)) continue
            for (const md of getDecorators(ts, m)) {
              const mn = decoratorName(ts, md)
              if (HTTP.has(mn)) {
                let sub = ''
                if (ts.isCallExpression(md.expression) && md.expression.arguments[0] && ts.isStringLiteral(md.expression.arguments[0])) {
                  sub = md.expression.arguments[0].text
                }
                routes.push({ method: mn.toUpperCase(), path: joinRoute(prefix, sub) })
              }
            }
          }
          out.controllers.push({ class: className, file: relPath, prefix, routes, deps: ctorDeps(ts, node) })
        } else if (name === 'Injectable') {
          out.providers.push({ class: className, file: relPath, deps: ctorDeps(ts, node) })
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return out
}

function joinRoute(prefix, sub) {
  const a = (prefix || '').replace(/\/+$/, '')
  const b = (sub || '').replace(/^\/+/, '')
  return '/' + [a, b].filter(Boolean).join('/')
}

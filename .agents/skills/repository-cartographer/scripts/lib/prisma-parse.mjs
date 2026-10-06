// prisma-parse.mjs — ownership/reference edges from schema.prisma (used by
// umi-cash and umi-dashboard). No PSL parser ships with `typescript`, so this is
// a hand-rolled block scanner.
// Sources: Prisma Schema reference (model, @relation); Referential actions;
// Relation mode; Self-relations.
//
// Caveats baked in: back-relation fields (no fields/references) are NOT counted
// (the owning side is the single FK source); enum-typed fields look like
// relations (PascalCase) and are excluded via the parsed enum set; absence of
// onDelete does NOT mean NoAction (default depends on optional/required +
// relationMode); relationMode="prisma" means NO real DB FK; @@map/@@schema mean
// model names != real table names — reconcile with the SQL layer, don't trust
// Prisma delete semantics over DB triggers.

import { readFileSync } from 'node:fs'
import { ATTRIBUTION } from './sql-schema.mjs'

// A model that is the multitenancy root (owns everything via tenant_id cascade)
// — excluded from domain ownership exactly like core.tenants in the SQL layer.
const TENANT_MODEL = /^tenants?$/i

export function parsePrisma(files) {
  const models = new Map() // Model -> { fields:[], map, schema, file }
  const enums = new Set()
  const datasources = []
  const relations = [] // { fromModel, field, toModel, refFields, onDelete, optional, list, file }

  for (const f of files) {
    if (f.lang !== 'prisma') continue
    let text
    try { text = readFileSync(f.path, 'utf8') } catch { continue }
    text = stripComments(text)

    for (const m of text.matchAll(/enum\s+(\w+)\s*\{/g)) enums.add(m[1])
    for (const m of text.matchAll(/datasource\s+\w+\s*\{([\s\S]*?)\}/g)) {
      const body = m[1]
      datasources.push({
        provider: field(body, 'provider'),
        relationMode: field(body, 'relationMode') || 'foreignKeys',
      })
    }

    for (const m of text.matchAll(/model\s+(\w+)\s*\{([\s\S]*?)\n\s*\}/g)) {
      const name = m[1]
      const body = m[2]
      const fields = []
      let map = null, schema = null
      for (const line of body.split('\n')) {
        const t = line.trim()
        if (!t) continue
        if (t.startsWith('@@map(')) { map = strArg(t); continue }
        if (t.startsWith('@@schema(')) { schema = strArg(t); continue }
        if (t.startsWith('@@') || t.startsWith('//')) continue
        const fm = /^(\w+)\s+([A-Za-z_][\w]*)(\[\])?(\?)?/.exec(t)
        if (!fm) continue
        const [, fname, ftype, list, opt] = fm
        fields.push({ name: fname, type: ftype, list: !!list, optional: !!opt })
        // relation with explicit fields/references = the OWNING side (real FK)
        const rel = /@relation\(([^)]*)\)/.exec(t)
        if (rel && /references\s*:/.test(rel[1])) {
          relations.push({
            fromModel: name, field: fname, toModel: ftype,
            refFields: listArg(rel[1], 'references'),
            fkFields: listArg(rel[1], 'fields'),
            onDelete: scalarArg(rel[1], 'onDelete'),
            optional: !!opt, list: !!list, file: f.relPath,
          })
        }
      }
      models.set(name, { name, fields, map, schema, file: f.relPath })
    }
  }

  // Owning relations only, excluding enum-typed false relations. Map onDelete →
  // owns (Cascade) vs references (SetNull/NoAction/Restrict/default).
  const ownsEdges = [], refEdges = []
  for (const r of relations) {
    if (enums.has(r.toModel)) continue
    if (!models.has(r.toModel)) continue
    const action = (r.onDelete || inferDefault(r)).toLowerCase()
    const attribution = (r.fkFields || []).some((c) => ATTRIBUTION.test(c)) || ATTRIBUTION.test(r.field)
    // Tenant-owner cascade is multitenancy cleanup, not domain ownership; and
    // created_by/user_id-style FKs are attribution references.
    if (action === 'cascade' && !TENANT_MODEL.test(r.toModel) && !attribution) {
      ownsEdges.push({ owner: r.toModel, part: r.fromModel, via: r.field, file: r.file })
    } else {
      refEdges.push({ from: r.fromModel, to: r.toModel, action, via: r.field, attribution, file: r.file })
    }
  }
  return { models, enums: [...enums], datasources, relations, ownsEdges, refEdges }
}

// Prisma default referential action: optional relation → SetNull, required →
// (connector default) Restrict. relationMode="prisma" emulates in client only.
function inferDefault(r) {
  return r.optional ? 'SetNull' : 'Restrict'
}

function stripComments(text) {
  return text.replace(/\/\/\/.*$/gm, '').replace(/\/\/.*$/gm, '')
}
function field(body, key) {
  const m = new RegExp(key + '\\s*=\\s*"([^"]*)"').exec(body)
  return m ? m[1] : null
}
function strArg(t) { const m = /"([^"]*)"/.exec(t); return m ? m[1] : null }
function scalarArg(args, key) {
  const m = new RegExp(key + '\\s*:\\s*(\\w+)').exec(args)
  return m ? m[1] : null
}
function listArg(args, key) {
  const m = new RegExp(key + '\\s*:\\s*\\[([^\\]]*)\\]').exec(args)
  return m ? m[1].split(',').map((s) => s.trim().replace(/"/g, '')).filter(Boolean) : []
}

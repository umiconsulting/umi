# Language & Framework Adapters

Per-language extraction signals and how to add a new one. Sources in `research-basis.md` §D.

## TypeScript / JavaScript / TSX — `lib/ts-graph.mjs`
TypeScript Compiler API only (`ts.createSourceFile` + `ts.forEachChild`). Edges from
`ImportDeclaration`, `ExportDeclaration` (re-export), `import x = require()`, dynamic
`import()`, and `require()` calls. Each edge is flagged `typeOnly` (from `import type` /
`isTypeOnly`), `dynamic`, and `test` (from `*.spec/*.test`/`__tests__`). Resolution: relative
paths (+ extension/`index` fallback), tsconfig `paths` (per-app, longest-prefix), else a bare
package = external. `typescript` is resolved from the target repo (zero-install).
*Gotchas:* non-literal specifiers and shadowed `require` can't be resolved (recorded as
unresolved/dynamic); no semantic analysis.

## NestJS — `adapters/nestjs.mjs`
`ts.getDecorators` (TS5). `@Module` → `imports/controllers/providers/exports` arrays
(identifiers, custom `{provide, useClass/useFactory/useValue/useExisting}`, `forwardRef(()=>X)`
recorded as acknowledged cycles); `@Controller('prefix')` + method `@Get/@Post/…` → routes;
`@Injectable` → provider; constructor params (+ `@Inject`) → DI edges; `@Global` recorded.
*Gotchas:* dynamic modules (`forRoot`/`forFeature`), `useFactory` values, spreads, and
string/symbol tokens are not fully static — flagged, not resolved.

## Deno edge functions — via `lib/ts-graph.mjs`
Files under `supabase/functions/**` parse with the same TS parser; specifiers bucket into
relative (keep explicit extension — no Node stripping), `http(s)://` remote, `npm:`/`jsr:`/
`node:` registry, else bare → import-map. *Gap:* bare-specifier import-map resolution and
remote-URL dedup are not fully implemented (remote/registry counted as external).

## SQL DDL — `lib/sql-schema.mjs`
Dollar-quote-aware statement split. `CREATE TABLE`, inline + table-level + `ALTER … ADD`
foreign keys, `ON DELETE` action, and `CREATE TRIGGER … EXECUTE FUNCTION/PROCEDURE`
(append-only detection). String literals blanked before FK matching. System schemas and multitenancy/
attribution FKs excluded from ownership. This is the primary **ownership** signal.

## Prisma — `lib/prisma-parse.mjs`
Hand-rolled block scanner (no PSL parser ships with `typescript`): `model`, fields,
`@relation(fields/references/onDelete)`, `enum` (to disambiguate PascalCase relation fields),
`datasource` provider/`relationMode`, `@@map/@@schema`. Only the owning side (has
`fields`+`references`) is counted; tenant-owner + attribution relations excluded, mirroring
the SQL layer. *Gotchas:* absence of `onDelete` ≠ NoAction; `relationMode="prisma"` = no DB
FK; reconcile names via `@@map` — trust DB triggers over Prisma delete semantics.

## Swift — `lib/swift-parse.mjs`
Regex after comment/string stripping + brace-depth tracking. Anchored `import` and
`struct/class/actor/enum/protocol/extension` declarations. Emits file→module and file→type
edges only — never symbol→module attribution (impossible without the compiler).
*Gotchas:* `#if`, macros, `class func`, strings can fool it; unsound by construction.

## Adding a new adapter
1. Write a parser in `lib/` (or `adapters/` for framework-specific) exporting a pure
   function `(files) => structured-data`.
2. Wire it into `cartograph.mjs`: parse, then feed its output into the graph / classifier /
   catalog. Keep it **zero-install** (Node built-ins + the repo's own toolchain).
3. Record edge kinds and any unsoundness so downstream layers can filter and the report can
   caveat. Add its signals to this file and, if it introduces a new claim, a source to
   `research-basis.md`.

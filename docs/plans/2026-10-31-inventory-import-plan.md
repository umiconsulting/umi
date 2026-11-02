# Inventory import implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Download and import inventory articles and complete recipes in CSV and Excel from the owner dashboard.

**Architecture:** Browser file adapters produce rows for pure preview planners. A persistent sequential runner calls existing administrative commands. The backend remains the write authority.

**Tech Stack:** React 18, Lingui 6, Vite 5, Vitest 2, Playwright, ExcelJS 4.4.0, read-excel-file 9.3.14, Papa Parse 5.7.0, existing NestJS API and PostgreSQL.

**Spec:** `docs/plans/2026-10-31-inventory-import-design.md`

## Global Constraints

- Formats: CSV UTF-8 and Excel .xlsx. Do not accept .xls, .xlsm or formulas.
- Limits: 2 MiB per file, 500 data rows, 100 recipes, 200 ingredients per recipe, worker timeout 15 seconds.
- Use exact quantities and integer minor units. Never round an imported amount.
- Preview and explicit confirmation precede all writes. Invalid recipes never save partial ingredients.
- Existing administrative commands own writes, permissions, transactions, audit, versions and idempotency.
- Persist the exact batch before sending. Retries reuse commandId, idempotencyKey, targetAggregateId and payload.
- Never redirect a prepared batch to a different merchant. Stop unsent commands when the merchant changes or the dialog closes.
- Use simple Spanish through Lingui. Preserve other locales and existing screens.
- One new PR from `feat/inventory-bulk-import`, directly to `staging`. PR #242 is already merged. Atomic commits. No merge or production deployment.
- Worktree: `/private/tmp/umi-inventory-staging-20261030`. Preserve the original checkout and other worktrees and services.
- No initial balances, purchase photos, forecasts or notifications in this task.

## File ownership

`src/lib/inventory-import/format.js`, `schema.js` and `worker.js` own file interpretation and download content.
`file-client.js` owns worker lifetime. `preview.js` owns file-to-command validation; split article and recipe planners if needed.
`runner.js` owns the persistent sequential batch. `inventory-import-dialog.jsx` owns the dashboard workflow.
`data.jsx` exposes explicit-merchant snapshot reads and command execution using the existing API helpers.
The existing workspaces only add entry buttons and refresh after successful writes.

### Task 1: CSV and Excel templates and file adapters

**Files:**

- Create: `apps/umi-dashboard/src/lib/inventory-import/{schema,format,worker,file-client}.js`
- Test: `apps/umi-dashboard/src/lib/inventory-import/format.spec.js`
- Modify: `apps/umi-dashboard/package.json`, `pnpm-lock.yaml`

**Interfaces:**

- `IMPORT_LIMITS = { maxBytes: 2097152, maxRows: 500, maxRecipes: 100, maxComponents: 200, timeoutMs: 15000 }`.
- `parseImportFile({ kind, format, bytes }) -> Promise<{ headers, rows }>`; kind is `items` or `recipes`; format is `csv` or `xlsx`; bytes is an ArrayBuffer.
- Each row: `{ rowNumber, values: { [column]: string }, errors: [{ code, column }] }`. File errors throw `Error` with stable `code`.
- `buildImportFile({ kind, format, purpose, references, results, labels }) -> Promise<{ bytes, mimeType, fileName }>`.
- Purpose: `template`, `guide`, `examples`, `references`, `results`. `references` uses `{ items, targets }`; `results` uses rows with `rowNumber, reference, status, message`.
- `runImportFileTask(action, payload, { signal } = {})` calls the matching adapter in a worker. action is `parse` or `build`.
- `schema.js` exports `ITEM_COLUMNS`, `RECIPE_COLUMNS`, `ITEM_TYPES`, `UNITS`, and stable Spanish column definitions.

- [ ] Write failing file tests using real workbooks and CSV, including a quoted multiline name, BOM, semicolon, blank rows, repeated headers, unknown headers, formula cells, dates, unsafe numeric cells and excessive size/rows.

```js
const csv = new TextEncoder().encode('codigo,nombre,tipo,unidad,decimales\r\n001,"Leche, entera",ingredient,liter,3\r\n');
const file = await parseImportFile({kind: 'items', format: 'csv', bytes: csv.buffer});
expect(file.rows[0]).toMatchObject({rowNumber: 2, values: {codigo: '001', nombre: 'Leche, entera'}});
```

- [ ] Run focused Vitest; record expected RED before adding implementation.
- [ ] Install exact ExcelJS 4.4.0 and Papa Parse 5.7.0 with pnpm under Node 22. Implement the interfaces.

```js
const result = Papa.parse(text, {header: false, dynamicTyping: false, skipEmptyLines: false, delimitersToGuess: [',', ';']});
const csv = Papa.unparse(rows, {escapeFormulae: true, newline: '\r\n'});
```

The parser preserves original line/row indices. Validate headers before mapping rows. Required item columns are `codigo,nombre,tipo,unidad,decimales`.
Optional item columns are `costo_unitario,existencia_minima,cantidad_preparacion,vida_util_dias`.
Recipe columns are `producto_id,variante_id,rendimiento,unidad_rendimiento,ingrediente_codigo,cantidad,unidad`; only variante_id may be blank or omitted.
No parser evaluates formulas. A formula cell is a row error, with its remaining values retained for recipe grouping.
Accept strings and finite safe numeric cells; reject dates, booleans, formulas and unsupported Excel object values.
Preserve original numeric XML text with read-excel-file/universal. Reject UNSAFE_NUMBER when ExcelJS's native numeric value differs from that exact value. The review regression is costo_unitario numeric XML `0.10000000000000001`; safe `0.1000` retains its original string.
Keep all data strings; numbers from Excel become ordinary decimal strings only when safe. Never silently accept exponent notation.
Excel parses only `Articulos` or `Recetas`; guide/example/reference sheets cannot become import data.
Template data sheets have headers only. Guide explains every field, valid code and example. All XLSX cells use explicit text values.
The recipe reference download lists product/variant IDs with names and ingredient codes with names, units and decimal precision.
CSV references use a combined typed list; XLSX can use separate reference sheets. Results contain every provided result row.
Use a worker for both formats. Terminate on completion, failure, timeout or AbortSignal. Lazy load ExcelJS inside format handling.
UI translation belongs to Task 3; return stable codes for errors. Export guide/copy descriptors from schema or a focused copy module. Resolve those through Lingui on the main thread and pass plain strings through `labels`. Keep column keys and data sheet names stable across locales.

- [ ] Run focused tests and lint the changed JS. Record versions and tests in the report.
- [ ] Commit this independently testable adapter as `feat(dashboard): add CSV and Excel inventory templates`.

### Task 2: Exact previews and recoverable batch execution

**Files:**

- Create: `apps/umi-dashboard/src/lib/inventory-import/{preview,runner}.js`, optional focused planner helpers.
- Test: `apps/umi-dashboard/src/lib/inventory-import/{preview,runner}.spec.js`

**Interfaces:**

- Consume parsed rows and column constants from Task 1.
- `buildImportPreview({ kind, parsed, snapshot }) -> { kind, entries, counts }`.
- Snapshot: `{ merchantId, items, recipes, targets }`, complete active/archived articles and active recipes/targets.
- Entry: `{ key, rowNumbers, reference, label, status, errors, command }`.
- Status: `new`, `update`, `unchanged`, `duplicate`, `error`; errors contain stable `code,column,rowNumber` as available.
- Command is null or `{ operation, targetAggregateId, targetVersion, parameters }`. Create IDs are assigned once when the batch is prepared.
- `prepareImportBatch({ merchantId, locationId, preview, storage }) -> batch`; persists before return, and refuses an unresolved prior batch.
- `readImportBatch(storage, merchantId, kind)` returns the validated saved batch or null.
- `runImportBatch({ batch, storage, execute, isCurrentMerchant, signal, onProgress, delay }) -> Promise<batch>`.
- `execute(merchantId, operation, targetAggregateId, options)` receives exact persisted identifiers and parameters.
- `clearImportBatch(storage, merchantId, kind)` refuses unresolved ambiguous commands. Terminal reports may be cleared explicitly.
- Batch entries retain preview rows and command results; a result adapter returns rows usable by Task 1 result export.

- [ ] Write RED tests for exact values and preview behavior, including whole-group recipe rejection.

```js
const preview = buildImportPreview({kind: 'items', parsed, snapshot});
expect(preview.entries[0].command.parameters.initialUnitCostMinor).toBe(1250);
expect(buildImportPreview({kind: 'recipes', parsed: inconsistentYieldRows, snapshot}).entries[0].status).toBe('error');
```

- [ ] Implement item create/update/unchanged with existing schemas as reference. Required codes are case-sensitive and merchant-scoped.
      Reject all duplicate item codes, archived targets, immutable field changes, invalid enum values, precision overflow and unsupported quantities.
      Blank optional cells omit updates. A zero cost remains zero. Never mutate stock, policies of existing articles or catalog products.
      New articles use `tracked` and `allow_and_flag`. Article quantity optional fields are scaled integers, matching the existing contract.
- [ ] Implement recipe grouping by product/variant. Match only active exact IDs from targets and active ingredient codes from items.
      Validate yield equality numerically and by unit; reject missing targets, wrong variants, repeated ingredients and groups over 200 components.
      If a row has no usable product/variant grouping key, block the recipe file until corrected; its intended recipe cannot safely be inferred.
      Use exact active item conversions or the base unit. Use `componentBaseQuantity` for exact per-yield consumption and safe bounds.
      Reject any invalid group as a whole. Preserve recipe shelf life by omitting it. Send the full component list on update.
      Compare persisted recipe inputs semantically, ignoring ingredient order and decimal representation, to avoid identical versions.
      Do not supply `replaceSalesMapping`; report the backend conflict for manual resolution. No implicit replacement authorization.
- [ ] Write RED recovery tests with an in-memory storage and stateful command receiver, then implement the runner.

```js
const before = prepareImportBatch({merchantId, locationId, preview, storage});
await runImportBatch({...options, batch: before}); // receiver records command, response is lost
const recovered = readImportBatch(storage, merchantId, 'items');
await runImportBatch({...options, batch: recovered});
expect(receiver.createdRecords).toHaveLength(1);
expect(receiver.received[1]).toEqual(receiver.received[0]);
```

Persist exact random UUIDs for every eligible command before the first send. Persist status before and after every command.
Persist the original selected location at confirmation. Reuse that location on every attempt, including a null location.
A saved `sending` entry becomes ambiguous on recovery. Unknown/5xx outcomes stop the batch and remain retryable.
Completed entries never resend. Definitive 4xx errors appear in results; 401/403/429 stop further sends and permit deliberate retry where valid.
Use a 400 ms default between sends. Tests inject delay. Check signal and merchant before each send and after delays.
Storage failure before send means no send; failure after response must leave a recoverable old identity, never allocate another.
Callback errors cannot turn a committed write into a fresh command. Persist results against the original merchant even after context changes.
Validate saved shape before use; malformed storage cannot trigger commands. Keep error messages bounded and avoid credentials.
Permit only the four article/recipe create/update operations in saved journals. Persist minimal result IDs and versions, not full projections.
Explicit clear may discard never-sent pending entries and definite401/403/429 retryable entries. It refuses sending/ambiguous outcomes and active runners. Saved records remain.

- [ ] Run focused tests and lint. Commit as `feat(dashboard): validate and recover inventory imports`.

### Task 3: Dashboard import workflow

**Files:**

- Create: `apps/umi-dashboard/src/screens/inventory-import-dialog.jsx` and focused supporting copy/style modules if needed.
- Modify: `apps/umi-dashboard/src/screens/inventory-workspace.jsx`, `recipe-workspace.jsx`, `data.jsx`, existing style and locale catalogs.
- Test: focused workflow tests following existing dashboard practices.

**Interfaces:**

- Consume the file, preview and runner interfaces from Tasks 1 and 2.
- Export `InventoryImportDialog({ kind, onClose, onSaved })` as the default component.
- Export `fetchInventoryImportSnapshot(merchantId)` and `executeInventoryImportCommand(merchantId, operation, targetAggregateId, options)` from data.jsx.
- Snapshot returns `{merchantId, items, recipes, targets}` with all pages, including archived items, active recipes and active product variants.
- Use existing `_apiFetch`, route builders and pagination safeguards; the explicit merchant argument determines every request URL.
- Import commands use the saved `options.locationId` and fixed `approvalId: null`. Capture the selected location at confirmation; never read the current location for a retry.

- [ ] Write a failing interaction or browser test for selecting a file, viewing preview and cancelling with zero commands.
- [ ] Add `Importar artículos` and `Importar recetas` to the corresponding workspace headers, gated by existing `merchant.manage`.
      The modal uses native dialog and the established preparation dialog focus/lifecycle pattern. It must work with keyboard and mobile width.
      Use simple Spanish actions: `Descargar plantilla`, `Excel (.xlsx)`, `CSV`, `Elegir archivo`, `Revisar archivo`, `Cancelar`, `Importar N artículos/recetas`, `Reintentar pendientes`, `Descargar resultado`.
      Offer guide, examples and references; explain code fields and that existing records can update. State that stock is entered through purchases or adjustments.
      Preview has summary counts and row numbers, status, name/reference and actionable error. Paginate long previews so 500 rows do not overflow.
      An invalid recipe lists all associated row numbers and the failing row. Confirmation states complete ingredient replacement for updated recipes.
      Disable save while references/file are loading or failed, when nothing changes, or when no valid entries remain.
      Only confirmation prepares/persists/sends a new batch. Loading, download and cancellation must not write.
- [ ] Integrate the runner and saved batch recovery. Display progress, stop/cancel safely, report successes/errors and refresh existing lists after writes.
      Before confirmation, `Cancelar` writes nothing. During a batch, `Detener pendientes` stops unsent entries and explains that saved records remain.
      Keep the exact saved batch immutable through an ambiguous result. Reopen/reload offers recovery before another file.
      An explicit `Nueva importación` may discard known unsent or definite rejected entries through clearImportBatch; it remains blocked for sending/ambiguous entries.
      The dialog aborts pending file work and unsent commands on unmount or merchant change; no stale preview can save to another merchant.
      Result downloads support both CSV and Excel and include all input rows, including duplicates and errors.
      Use a dedicated copy mapper for stable validation/backend errors; never show raw objects, stack traces or English codes to owners.
- [ ] Extract/compile Lingui; fill new English translations, preserving existing catalogs. Run focused workflow tests, full dashboard tests, lint and build.
- [ ] Commit as `feat(dashboard): add article and recipe import workflow`.

### Task 4: Real browser and database verification

**Files:**

- Add: durable browser/integration tests in existing test directories, plus sanitized evidence under `docs/verification/`.
- Temporary fixture scripts and private credentials stay under `/private/tmp`, mode 600 for credentials.

**Interfaces:**

- Exercise the production workflow from Task 3; invoke existing API checkout flow for the sale assertion.
- Use a new isolated PostgreSQL database and new preview ports; preserve all previous environments.

- [ ] Read `docs/development/LOCAL_VERIFICATION_PLAYBOOK.md`. Inspect existing preparation/phase2 fixture scripts as patterns without printing credentials.
- [ ] Seed owner, a second merchant, products/variants, ingredients, a registered exact conversion and a stock location.
- [ ] Run actual Chromium CDP clicks for both template downloads and both import formats, with a fresh context.

```js
await page.getByRole('button', {name: 'Importar artículos', exact: true}).click();
await page.getByLabel('Archivo').setInputFiles(csvPath);
await page.getByRole('button', {name: 'Revisar archivo', exact: true}).click();
await expect(page.getByText('Nuevo', {exact: true}).first()).toBeVisible();
```

Check cancellation writes nothing. Confirm valid articles and mixed valid/invalid recipes. Download result CSV and XLSX and inspect actual contents.
Verify item cost and quantities exactly in PostgreSQL. Reimport unchanged files and assert no duplicate articles or new recipe versions.
Update one recipe and assert prior version/history remains. A stale preview must refuse a concurrent update.
Simulate lost response after server commit and retry/reload; assert one committed record and reused command identity.
Verify an invalid recipe never leaves a partial recipe or active sales mapping. Verify merchant change stops unsent work.
Make a sale with the imported recipe and verify exact inventory movements through the existing checkout flow.
Test mobile at 390 px and keyboard focus/escape; verify preview/result scroll and aligned buttons. No horizontal page overflow.
Verify a user without merchant.manage cannot access imports and API writes still refuse unauthorized access.

- [ ] Record observed facts, commands, versions and limitations without secrets. Run Gitleaks with redaction before committing evidence.
- [ ] Run the relevant dashboard build/lint/tests and `check:pr`; run API/schema tests only if their code changes or a named concern requires them.
- [ ] Commit tests and evidence as `test(inventory): verify CSV and Excel import workflows`.

## Delivery

After task reviews and a final review, push atomic commits to `feat/inventory-bulk-import`.
Create one new PR for imports, with base `staging`. Describe the final scope and verified results.
Confirm published HEAD, CI and open review state. Do not merge or enable auto-merge.
